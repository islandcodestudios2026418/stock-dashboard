import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/history?symbol=NVDA&days=30
// Returns scoring time series for chart rendering (no auth — read-only)

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  const days = Math.min(Number(req.nextUrl.searchParams.get("days")) || 30, 365);

  if (!symbol) return NextResponse.json({ error: "Missing ?symbol= param" }, { status: 400 });

  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const cutoff = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("analysis_results")
    .select("date, scoring")
    .eq("symbol", symbol)
    .gte("date", cutoff)
    .order("date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const history = (data || []).map((r: { date: string; scoring?: { avgScore?: number; consensus?: boolean; agents?: { agent: string; score: number }[] } }) => ({
    date: r.date,
    avgScore: r.scoring?.avgScore ?? 0,
    consensus: r.scoring?.consensus ?? false,
    agents: r.scoring?.agents?.map(a => ({ name: a.agent, score: a.score })) || [],
  }));

  return NextResponse.json({ symbol, days, count: history.length, history });
}
