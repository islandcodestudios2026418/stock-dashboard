import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// GET /api/cron/results?date=YYYY-MM-DD&days=7
// Returns analysis from Supabase. Defaults to latest run.

export async function GET(req: NextRequest) {
  const supabase = getSupabase();
  const dateParam = req.nextUrl.searchParams.get("date");
  const days = parseInt(req.nextUrl.searchParams.get("days") || "1");

  // Get the target date (latest run if not specified)
  let date = dateParam;
  if (!date) {
    const { data: run } = await supabase.from("analysis_runs").select("date, ts").order("date", { ascending: false }).limit(1).single();
    if (!run) return NextResponse.json({ date: null, count: 0, results: [] });
    date = run.date;
  }

  if (days > 1) {
    // Historical: return last N days
    const { data: results } = await supabase
      .from("analysis_results")
      .select("symbol, date, scoring, trade_plan, ts")
      .order("date", { ascending: false })
      .limit(days * 10);
    return NextResponse.json({ date, count: results?.length || 0, results: results || [] });
  }

  // Single day
  const { data: results } = await supabase
    .from("analysis_results")
    .select("symbol, date, scoring, indicators, trade_plan, analysis, ts")
    .eq("date", date);

  const { data: run } = await supabase.from("analysis_runs").select("ts").eq("date", date).single();

  return NextResponse.json({
    date,
    ts: run?.ts || Date.now(),
    count: results?.length || 0,
    results: (results || []).map(r => ({ symbol: r.symbol, date: r.date, scoring: r.scoring, tradePlan: r.trade_plan, indicators: r.indicators, analysis: r.analysis, ts: r.ts })),
  });
}
