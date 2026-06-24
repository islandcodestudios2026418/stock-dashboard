import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// /api/journal — Trade decision journal for Phase 1 semi-auto mode
// POST: log a decision (accept/reject/defer a consensus pick)
// GET: read decision history

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

// GET: list decisions (optional ?symbol=, ?status=, ?days=)
export async function GET(req: NextRequest) {
  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const symbol = req.nextUrl.searchParams.get("symbol");
  const status = req.nextUrl.searchParams.get("status"); // accepted/rejected/deferred
  const days = Number(req.nextUrl.searchParams.get("days")) || 30;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  let query = supabase.from("trade_decisions").select("*").gte("created_at", cutoff).order("created_at", { ascending: false });
  if (symbol) query = query.eq("symbol", symbol);
  if (status) query = query.eq("decision", status);

  const { data, error } = await query.limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ decisions: data || [] });
}

// POST: log a new decision
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const body = await req.json();
  const { symbol, decision, reason, avg_score, conviction_score, trade_plan } = body;

  if (!symbol || !decision) return NextResponse.json({ error: "Missing symbol or decision" }, { status: 400 });
  if (!["accepted", "rejected", "deferred"].includes(decision)) {
    return NextResponse.json({ error: "Decision must be: accepted, rejected, deferred" }, { status: 400 });
  }

  const { data, error } = await supabase.from("trade_decisions").insert({
    symbol,
    decision,
    reason: reason || null,
    avg_score: avg_score || null,
    conviction_score: conviction_score || null,
    trade_plan: trade_plan || null,
    date: new Date().toISOString().split("T")[0],
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logged: data });
}
