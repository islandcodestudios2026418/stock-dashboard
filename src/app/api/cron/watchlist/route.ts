import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// GET /api/cron/watchlist — list active watchlist
// POST /api/cron/watchlist — add symbol { symbol, name? }
// DELETE /api/cron/watchlist?symbol=NASDAQ:TSLA — remove

const CRON_SECRET = process.env.CRON_SECRET || "";
function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

export async function GET() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("watchlists").select("*").eq("active", true).order("added_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ watchlist: data });
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabase();
  const body = await req.json();
  const symbol = body.symbol?.trim();
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const { error } = await supabase.from("watchlists").upsert(
    { symbol, name: body.name || null, active: true },
    { onConflict: "symbol" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ added: symbol });
}

export async function DELETE(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabase();
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "symbol param required" }, { status: 400 });

  const { error } = await supabase.from("watchlists").update({ active: false }).eq("symbol", symbol);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ removed: symbol });
}
