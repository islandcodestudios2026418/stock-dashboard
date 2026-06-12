import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// GET /api/backtest/results — fetch stored backtest results
// POST /api/backtest/results — store backtest results (requires CRON_SECRET)

export async function GET(req: NextRequest) {
  const supabase = getSupabase();
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol");
  const limit = parseInt(searchParams.get("limit") || "50");

  let query = supabase
    .from("backtest_results")
    .select("*")
    .order("run_date", { ascending: false })
    .limit(limit);

  if (symbol) query = query.eq("symbol", symbol);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const supabase = getSupabase();
  const { error } = await supabase.from("backtest_results").upsert(body, { onConflict: "symbol,run_date" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
