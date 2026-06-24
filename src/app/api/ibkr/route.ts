import { NextRequest, NextResponse } from "next/server";
import { placeOrder, cancelOrder, getPositions, getAccountSummary, getOpenOrders, calculatePositionSize, type IBKROrder } from "@/lib/ibkr-client";

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

// GET /api/ibkr — account info, positions, open orders
export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const action = req.nextUrl.searchParams.get("action") || "status";

  try {
    switch (action) {
      case "positions":
        return NextResponse.json({ positions: await getPositions() });
      case "orders":
        return NextResponse.json({ orders: await getOpenOrders() });
      case "summary":
        return NextResponse.json({ summary: await getAccountSummary() });
      default:
        return NextResponse.json({
          live: process.env.IBKR_LIVE === "true",
          accountId: process.env.IBKR_ACCOUNT_ID ? "configured" : "missing",
          gatewayUrl: process.env.IBKR_GATEWAY_URL || "https://localhost:5000/v1/api",
        });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// POST /api/ibkr — place order or execute consensus pick
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { action } = body;

  try {
    if (action === "execute_pick") {
      // Auto-execute a consensus pick with risk management
      const { symbol, currentPrice, stopLossPrice, capital } = body;
      if (!symbol || !currentPrice || !stopLossPrice) {
        return NextResponse.json({ error: "Missing symbol, currentPrice, or stopLossPrice" }, { status: 400 });
      }

      const sizing = calculatePositionSize(currentPrice, stopLossPrice, capital);
      if (sizing.shares === 0) {
        return NextResponse.json({ error: "Position size = 0 (stop too close or price too high)" }, { status: 400 });
      }

      // Place main entry order (limit at current price)
      const entryOrder: IBKROrder = {
        symbol, side: "BUY", quantity: sizing.shares,
        orderType: "LMT", price: currentPrice, tif: "DAY",
      };
      const entryResult = await placeOrder(entryOrder);

      return NextResponse.json({
        action: "execute_pick",
        symbol,
        sizing,
        entry: entryResult,
        live: process.env.IBKR_LIVE === "true",
      });
    }

    if (action === "place") {
      const order: IBKROrder = {
        symbol: body.symbol,
        side: body.side || "BUY",
        quantity: body.quantity,
        orderType: body.orderType || "LMT",
        price: body.price,
        auxPrice: body.auxPrice,
        tif: body.tif || "DAY",
        outsideRth: body.outsideRth,
      };
      const result = await placeOrder(order);
      return NextResponse.json({ result });
    }

    if (action === "cancel") {
      const result = await cancelOrder(body.orderId);
      return NextResponse.json({ result });
    }

    return NextResponse.json({ error: "Unknown action. Use: execute_pick, place, cancel" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
