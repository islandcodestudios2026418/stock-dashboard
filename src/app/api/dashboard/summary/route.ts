import { NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/dashboard/summary — one-page system health for Phase 1 monitoring
// No auth required (read-only aggregate data, no PII)

export async function GET() {
  const supabase = trySupabase();
  if (!supabase) {
    return NextResponse.json({ status: "degraded", reason: "Supabase not configured" }, { status: 503 });
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split("T")[0];

  // Last run
  const { data: lastRun } = await supabase
    .from("analysis_runs")
    .select("date, ts")
    .order("ts", { ascending: false })
    .limit(1)
    .single();

  // Open positions count
  const { count: openPositions } = await supabase
    .from("portfolio_positions")
    .select("*", { count: "exact", head: true })
    .eq("status", "open");

  // This week's consensus picks
  const { data: weekResults } = await supabase
    .from("analysis_results")
    .select("symbol, date, scoring")
    .gte("date", weekAgo);

  const consensus = (weekResults || []).filter((r: { scoring?: { consensus?: boolean } }) => r.scoring?.consensus);

  // Watchlist size
  const { count: watchlistSize } = await supabase
    .from("watchlists")
    .select("*", { count: "exact", head: true })
    .eq("active", true);

  // Compute last run age
  const lastRunAge = lastRun?.ts ? Math.round((Date.now() - lastRun.ts) / 3600000) : null;
  const healthy = lastRunAge !== null && lastRunAge < 24;

  return NextResponse.json({
    status: healthy ? "healthy" : "stale",
    lastRun: lastRun ? { date: lastRun.date, hoursAgo: lastRunAge } : null,
    openPositions: openPositions || 0,
    watchlistSize: watchlistSize || 0,
    weeklyConsensusPicks: consensus.length,
    weeklyScans: weekResults?.length || 0,
    crons: {
      usPreMarket: "12:30 UTC (20:30 TW)",
      twPreMarket: "00:00 UTC (08:00 TW)",
      asiaClose: "13:30 UTC (21:30 TW)",
      monitor: "every 5min (US market hours)",
      weeklyReport: "Sunday 20:00 UTC",
      watchlistRotation: "Sunday 20:30 UTC",
    },
  });
}
