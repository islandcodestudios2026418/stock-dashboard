// Phase 3: IBKR Web API Client
// Wraps Interactive Brokers REST API for order execution.
// Default: paper trading. Live requires IBKR_LIVE=true env var.

export interface IBKRConfig {
  baseUrl: string; // e.g. https://localhost:5000/v1/api (Client Portal Gateway)
  accountId: string;
  live: boolean;
}

export interface IBKROrder {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  orderType: "MKT" | "LMT" | "STP" | "STP_LMT";
  price?: number;       // for LMT/STP_LMT
  auxPrice?: number;    // for STP/STP_LMT (stop price)
  tif: "DAY" | "GTC" | "IOC";
  outsideRth?: boolean;
}

export interface IBKROrderResult {
  orderId: string;
  status: string;
  symbol: string;
  filledQty: number;
  remainingQty: number;
  avgPrice?: number;
}

export interface IBKRPosition {
  symbol: string;
  position: number;
  avgCost: number;
  marketValue?: number;
  unrealizedPnl?: number;
}

export interface IBKRAccountSummary {
  netLiquidation: number;
  buyingPower: number;
  availableFunds: number;
  totalCashValue: number;
}

const ORDER_TYPE_MAP = { MKT: 1, LMT: 2, STP: 3, STP_LMT: 4 } as const;
const TIF_MAP = { DAY: 0, GTC: 1, IOC: 3 } as const;
const SIDE_MAP = { BUY: 1, SELL: 2 } as const;

function getConfig(): IBKRConfig {
  return {
    baseUrl: process.env.IBKR_GATEWAY_URL || "https://localhost:5000/v1/api",
    accountId: process.env.IBKR_ACCOUNT_ID || "",
    live: process.env.IBKR_LIVE === "true",
  };
}

async function ibkrFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const config = getConfig();
  if (!config.accountId) throw new Error("IBKR_ACCOUNT_ID not set");

  const url = `${config.baseUrl}${path}`;
  return fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
}

export async function getAccounts(): Promise<string[]> {
  const res = await ibkrFetch("/accounts");
  if (!res.ok) throw new Error(`IBKR accounts failed: ${res.status}`);
  const data = await res.json();
  return data.accounts || [];
}

export async function getAccountSummary(): Promise<IBKRAccountSummary> {
  const { accountId } = getConfig();
  const res = await ibkrFetch(`/accounts/${accountId}/summary`);
  if (!res.ok) throw new Error(`IBKR summary failed: ${res.status}`);
  const data = await res.json();
  const s = data.Summary || {};
  return {
    netLiquidation: s.NetLiquidation || 0,
    buyingPower: s.BuyingPower || 0,
    availableFunds: s.AvailableFunds || 0,
    totalCashValue: s.TotalCashValue || 0,
  };
}

export async function getPositions(): Promise<IBKRPosition[]> {
  const { accountId } = getConfig();
  const res = await ibkrFetch(`/accounts/${accountId}/positions`);
  if (!res.ok) throw new Error(`IBKR positions failed: ${res.status}`);
  const data = await res.json();
  return (data || []).map((p: Record<string, number>) => ({
    symbol: String(p.Ticker || p.ContractId),
    position: p.Position || 0,
    avgCost: p.AverageCost || 0,
  }));
}

export async function getOpenOrders(): Promise<IBKROrderResult[]> {
  const { accountId } = getConfig();
  const res = await ibkrFetch(`/accounts/${accountId}/orders`);
  if (!res.ok) throw new Error(`IBKR orders failed: ${res.status}`);
  const data = await res.json();
  return (data || []).map((o: Record<string, unknown>) => ({
    orderId: String(o.CustomerOrderId),
    status: String(o.Status || ""),
    symbol: String(o.Ticker || ""),
    filledQty: Number(o.FilledQuantity || 0),
    remainingQty: Number(o.RemainingQuantity || 0),
    avgPrice: Number(o.Price || 0),
  }));
}

export async function placeOrder(order: IBKROrder): Promise<IBKROrderResult> {
  const config = getConfig();

  // Safety: refuse live orders unless explicitly enabled
  if (!config.live) {
    return {
      orderId: `PAPER-${Date.now()}`,
      status: "SIMULATED",
      symbol: order.symbol,
      filledQty: 0,
      remainingQty: order.quantity,
      avgPrice: order.price,
    };
  }

  const body = {
    Ticker: order.symbol,
    ListingExchange: "SMART",
    InstrumentType: "STK",
    Currency: "USD",
    Quantity: order.quantity,
    Price: order.price || 0,
    "Order Type": ORDER_TYPE_MAP[order.orderType],
    "Aux Price": order.auxPrice || 0,
    "Time in Force": TIF_MAP[order.tif],
    Side: SIDE_MAP[order.side],
    "Outside RTH": order.outsideRth ? 1 : 0,
    CustomerOrderId: `SD-${Date.now()}`,
  };

  const res = await ibkrFetch(`/accounts/${config.accountId}/orders`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`IBKR place order failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  const result = Array.isArray(data) ? data[0] : data;
  return {
    orderId: String(result.CustomerOrderId || body.CustomerOrderId),
    status: String(result.Status || "PendingNew"),
    symbol: order.symbol,
    filledQty: Number(result.FilledQuantity || 0),
    remainingQty: Number(result.RemainingQuantity || order.quantity),
    avgPrice: Number(result.Price || order.price || 0),
  };
}

export async function cancelOrder(orderId: string): Promise<{ success: boolean; message: string }> {
  const { accountId } = getConfig();
  const res = await ibkrFetch(`/accounts/${accountId}/orders/${orderId}`, { method: "DELETE" });
  if (!res.ok) return { success: false, message: `Cancel failed: ${res.status}` };
  return { success: true, message: `Order ${orderId} cancelled` };
}

// Place bracket order: entry (LMT) + stop-loss (STP) + optional take-profit (LMT)
export async function placeBracketOrder(params: {
  symbol: string;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice?: number;
  shares: number;
}): Promise<{ entry: IBKROrderResult; stopLoss: IBKROrderResult; takeProfit?: IBKROrderResult }> {
  const entry = await placeOrder({
    symbol: params.symbol, side: "BUY", quantity: params.shares,
    orderType: "LMT", price: params.entryPrice, tif: "GTC",
  });

  const stopLoss = await placeOrder({
    symbol: params.symbol, side: "SELL", quantity: params.shares,
    orderType: "STP", auxPrice: params.stopLossPrice, tif: "GTC",
  });

  let takeProfit: IBKROrderResult | undefined;
  if (params.takeProfitPrice) {
    takeProfit = await placeOrder({
      symbol: params.symbol, side: "SELL", quantity: params.shares,
      orderType: "LMT", price: params.takeProfitPrice, tif: "GTC",
    });
  }

  return { entry, stopLoss, takeProfit };
}

// Calculate position size based on risk management rules
// $30K capital, 40% max loss = $12K risk budget, split across max 3 positions
export function calculatePositionSize(
  price: number,
  stopLossPrice: number,
  capital = 30000,
  maxPositions = 3,
): { shares: number; dollarRisk: number; positionValue: number } {
  const riskPerPosition = capital / maxPositions * 0.4; // 40% of allocated capital
  const riskPerShare = Math.abs(price - stopLossPrice);
  if (riskPerShare <= 0) return { shares: 0, dollarRisk: 0, positionValue: 0 };

  const shares = Math.floor(riskPerPosition / riskPerShare);
  const positionValue = shares * price;

  // Cap at available capital per position
  const maxShares = Math.floor((capital / maxPositions) / price);
  const finalShares = Math.min(shares, maxShares);

  return {
    shares: finalShares,
    dollarRisk: finalShares * riskPerShare,
    positionValue: finalShares * price,
  };
}
