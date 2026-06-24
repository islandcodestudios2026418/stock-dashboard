import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// /api/alerts — CRUD for per-symbol custom alert rules
const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

// GET: list all alert rules (no auth for read)
export async function GET(req: NextRequest) {
  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const symbol = req.nextUrl.searchParams.get("symbol");
  let query = supabase.from("alert_rules").select("*").eq("active", true);
  if (symbol) query = query.eq("symbol", symbol);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data || [] });
}

// POST: create/update a rule
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const body = await req.json();
  const { symbol, min_score, notify_on_rise, cooldown_hours } = body;
  if (!symbol) return NextResponse.json({ error: "Missing symbol" }, { status: 400 });

  const { data, error } = await supabase.from("alert_rules").upsert({
    symbol,
    min_score: min_score ?? 65,
    notify_on_rise: notify_on_rise ?? true,
    cooldown_hours: cooldown_hours ?? 24,
    active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "symbol" }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

// DELETE: deactivate a rule
export async function DELETE(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const { symbol } = await req.json();
  if (!symbol) return NextResponse.json({ error: "Missing symbol" }, { status: 400 });

  const { error } = await supabase.from("alert_rules").update({ active: false }).eq("symbol", symbol);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ removed: symbol });
}
