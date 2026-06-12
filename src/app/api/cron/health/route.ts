import { NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/health — unauthenticated health check for Zeabur
export async function GET() {
  const supabase = trySupabase();

  let lastRun: { date: string; ts: number } | null = null;
  if (supabase) {
    const { data } = await supabase
      .from("analysis_runs")
      .select("date,ts")
      .order("date", { ascending: false })
      .limit(1)
      .single();
    if (data) lastRun = data;
  }

  const ageMs = lastRun ? Date.now() - lastRun.ts : Infinity;
  const healthy = lastRun ? ageMs < 172800000 : true; // <2 days or first deploy

  return NextResponse.json({
    status: healthy ? "ok" : "stale",
    uptime: process.uptime(),
    lastRun: lastRun?.date ?? null,
    ageHours: lastRun ? Math.round(ageMs / 3600000 * 10) / 10 : null,
    supabase: !!supabase,
  });
}
