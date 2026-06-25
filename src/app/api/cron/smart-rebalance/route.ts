import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/smart-rebalance — suggest position size adjustments based on correlation + momentum
// Rules: avoid correlated pairs, scale into winners, trim losers, respect $30K total capital.

const CRON_SECRET = process.env.CRON_SECRET || "";
const TOTAL_CAPITAL = 30000;
const MAX_POSITIONS = 3;

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

async function fetchReturns(symbol: string, days: number): Promise<number[] | null> {
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const period1 = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
    const result = await yf.chart(symbol, { period1, interval: "1d" });
    const closes = (result.quotes || []).filter(q => q.close != null).map(q => q.close!);
    if (closes.length < 20) return null;
    return closes.slice(1).map((c, i) => (c - closes[i]) / closes[i]);
  } catch { return null; }
}

function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 10) return 0;
  const ax = a.slice(-n), bx = b.slice(-n);
  const meanA = ax.reduce((s, v) => s + v, 0) / n;
  const meanB = bx.reduce((s, v) => s + v, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = ax[i] - meanA, db = bx[i] - meanB;
    num += da * db; denA += da * da; denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

function momentum20d(returns: number[]): number {
  if (returns.length < 20) return 0;
  return returns.slice(-20).reduce((a, b) => a + b, 0) * 100;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  // Get open positions
  const { data: positions } = await supabase
    .from("portfolio_positions")
    .select("*")
    .eq("status", "open");

  if (!positions || positions.length === 0) {
    return NextResponse.json({ message: "No open positions to rebalance", suggestions: [] });
  }

  // Fetch 60d returns for each position
  const posData: { symbol: string; yahooSym: string; shares: number; entry_price: number; returns: number[] | null; currentPrice?: number }[] = [];
  for (const pos of positions) {
    const raw = pos.symbol.includes(":") ? pos.symbol.split(":")[1] : pos.symbol;
    const yahoo = pos.symbol.startsWith("TWSE:") ? `${raw}.TW` : raw;
    const returns = await fetchReturns(yahoo, 60);
    posData.push({ symbol: pos.symbol, yahooSym: yahoo, shares: pos.shares, entry_price: pos.entry_price, returns });
  }

  // Get current prices from returns data
  for (const p of posData) {
    if (p.returns && p.returns.length > 0) {
      // Approximate current price from entry + cumulative returns
      const cumReturn = p.returns.reduce((acc, r) => acc * (1 + r), 1);
      p.currentPrice = p.entry_price * cumReturn;
    }
  }

  // Compute pairwise correlations
  const corrWarnings: string[] = [];
  for (let i = 0; i < posData.length; i++) {
    for (let j = i + 1; j < posData.length; j++) {
      const ri = posData[i].returns, rj = posData[j].returns;
      if (!ri || !rj) continue;
      const corr = correlation(ri, rj);
      if (corr > 0.7) {
        corrWarnings.push(`⚠️ ${posData[i].symbol} ↔ ${posData[j].symbol}: corr=${corr.toFixed(2)} — consider trimming one`);
      }
    }
  }

  // Score each position for rebalancing
  const suggestions: { symbol: string; action: string; reason: string; currentWeight: number; suggestedWeight: number }[] = [];
  const totalValue = posData.reduce((s, p) => s + (p.currentPrice || p.entry_price) * p.shares, 0);

  for (const pos of posData) {
    const value = (pos.currentPrice || pos.entry_price) * pos.shares;
    const currentWeight = (value / totalValue) * 100;
    const mom = pos.returns ? momentum20d(pos.returns) : 0;
    const pnl = pos.currentPrice ? ((pos.currentPrice - pos.entry_price) / pos.entry_price) * 100 : 0;

    let action = "HOLD";
    let reason = "";
    let suggestedWeight = currentWeight;

    if (mom > 5 && pnl > 10) {
      // Winner with momentum — scale in (up to 1/3 of capital)
      suggestedWeight = Math.min(currentWeight * 1.2, (TOTAL_CAPITAL / MAX_POSITIONS / totalValue) * 100);
      action = "ADD";
      reason = `Strong momentum (${mom.toFixed(1)}% 20d) + profitable (${pnl.toFixed(1)}%)`;
    } else if (mom < -5 || pnl < -15) {
      // Loser or losing momentum — trim
      suggestedWeight = currentWeight * 0.7;
      action = "TRIM";
      reason = mom < -5 ? `Negative momentum (${mom.toFixed(1)}% 20d)` : `Losing position (${pnl.toFixed(1)}%)`;
    } else {
      reason = `Stable (mom=${mom.toFixed(1)}%, pnl=${pnl.toFixed(1)}%)`;
    }

    suggestions.push({ symbol: pos.symbol, action, reason, currentWeight: +currentWeight.toFixed(1), suggestedWeight: +suggestedWeight.toFixed(1) });
  }

  // Check if over-concentrated
  const maxWeight = Math.max(...suggestions.map(s => s.currentWeight));
  const concentrationWarning = maxWeight > 50 ? `⚠️ Over-concentrated: top position is ${maxWeight.toFixed(0)}% of portfolio` : null;

  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    positions: positions.length,
    totalValue: +totalValue.toFixed(2),
    capital: TOTAL_CAPITAL,
    suggestions,
    correlationWarnings: corrWarnings,
    concentrationWarning,
    summary: suggestions.filter(s => s.action !== "HOLD").length > 0
      ? `${suggestions.filter(s => s.action === "ADD").length} add, ${suggestions.filter(s => s.action === "TRIM").length} trim`
      : "✅ No rebalancing needed",
  });
}
