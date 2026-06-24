import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/portfolio/performance — aggregate stats from closed positions

export async function GET(req: NextRequest) {
  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const { data: closed } = await supabase
    .from("portfolio_positions")
    .select("*")
    .in("status", ["closed", "stopped"]);

  if (!closed || closed.length === 0) {
    return NextResponse.json({ trades: 0, message: "No closed positions yet" });
  }

  const returns: number[] = [];
  let wins = 0;
  let totalPnl = 0;

  for (const pos of closed) {
    if (!pos.exit_price || !pos.entry_price) continue;
    const pnl = (pos.exit_price - pos.entry_price) * pos.shares;
    const pctReturn = (pos.exit_price - pos.entry_price) / pos.entry_price;
    returns.push(pctReturn);
    totalPnl += pnl;
    if (pctReturn > 0) wins++;
  }

  const trades = returns.length;
  const winRate = trades > 0 ? wins / trades : 0;
  const avgReturn = trades > 0 ? returns.reduce((a, b) => a + b, 0) / trades : 0;
  const maxReturn = trades > 0 ? Math.max(...returns) : 0;
  const maxDrawdown = trades > 0 ? Math.min(...returns) : 0;

  // Sharpe ratio (annualized, assuming 252 trading days, risk-free = 0)
  let sharpe = 0;
  if (trades > 1) {
    const mean = avgReturn;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (trades - 1);
    const std = Math.sqrt(variance);
    sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  }

  return NextResponse.json({
    trades,
    wins,
    winRate: +(winRate * 100).toFixed(1),
    avgReturn: +(avgReturn * 100).toFixed(1),
    maxReturn: +(maxReturn * 100).toFixed(1),
    maxDrawdown: +(maxDrawdown * 100).toFixed(1),
    totalPnl: +totalPnl.toFixed(2),
    sharpe: +sharpe.toFixed(2),
  });
}
