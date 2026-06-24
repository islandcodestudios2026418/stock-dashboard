import { NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/pending-picks — lists consensus picks not yet acted on (no decision logged)
// Used by dashboard to show "action required" items

export async function GET() {
  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  // Get recent consensus picks (last 7 days)
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

  const { data: results } = await supabase
    .from("analysis_results")
    .select("symbol, date, scoring, trade_plan")
    .gte("date", cutoff)
    .not("scoring->>consensus", "is", null);

  const consensusPicks = (results || []).filter((r: { scoring?: { consensus?: boolean } }) => r.scoring?.consensus);

  // Get decisions already logged
  const { data: decisions } = await supabase
    .from("trade_decisions")
    .select("symbol, date")
    .gte("date", cutoff);

  const decidedSet = new Set((decisions || []).map((d: { symbol: string; date: string }) => `${d.symbol}:${d.date}`));

  // Filter to picks without decisions
  const pending = consensusPicks
    .filter((p: { symbol: string; date: string }) => !decidedSet.has(`${p.symbol}:${p.date}`))
    .map((p: { symbol: string; date: string; scoring?: { avgScore?: number; conviction?: { convictionScore?: number } }; trade_plan?: unknown }) => ({
      symbol: p.symbol,
      date: p.date,
      avgScore: p.scoring?.avgScore,
      conviction: p.scoring?.conviction?.convictionScore,
      tradePlan: p.trade_plan,
    }));

  return NextResponse.json({ pending, count: pending.length });
}
