import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

// GET /api/portfolio — list positions with live P&L
export async function GET(req: NextRequest) {
  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "No Supabase" }, { status: 503 });

  const status = req.nextUrl.searchParams.get("status") || "open";
  const { data, error } = await supabase
    .from("portfolio_positions")
    .select("*")
    .eq("status", status)
    .order("entry_date", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fetch live prices for open positions
  if (status === "open" && data && data.length > 0) {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

    const enriched = await Promise.all(data.map(async (pos) => {
      try {
        const ticker = pos.symbol.includes(":") ? pos.symbol.split(":")[1] : pos.symbol;
        const yahooSym = pos.symbol.startsWith("TWSE:") ? `${ticker}.TW` : ticker;
        const quote = await yf.quote(yahooSym) as unknown as { regularMarketPrice?: number };
        const currentPrice = quote.regularMarketPrice || pos.entry_price;
        const pnl = (currentPrice - pos.entry_price) * pos.shares;
        const pnlPct = (currentPrice - pos.entry_price) / pos.entry_price * 100;
        return { ...pos, currentPrice, pnl: +pnl.toFixed(2), pnlPct: +pnlPct.toFixed(2) };
      } catch {
        return { ...pos, currentPrice: null, pnl: null, pnlPct: null };
      }
    }));
    return NextResponse.json({ positions: enriched });
  }

  return NextResponse.json({ positions: data });
}

// POST /api/portfolio — open a new position
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "No Supabase" }, { status: 503 });

  const body = await req.json();
  const { symbol, entry_price, shares, stop_loss, target, notes } = body;
  if (!symbol || !entry_price || !shares) {
    return NextResponse.json({ error: "symbol, entry_price, shares required" }, { status: 400 });
  }

  const entry_date = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase.from("portfolio_positions").insert({
    symbol, entry_date, entry_price, shares, stop_loss, target, notes, status: "open",
    peak_price: entry_price,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ position: data }, { status: 201 });
}

// PATCH /api/portfolio — close a position
export async function PATCH(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "No Supabase" }, { status: 503 });

  const body = await req.json();
  const { id, exit_price, status: newStatus } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (exit_price) { update.exit_price = exit_price; update.exit_date = new Date().toISOString().split("T")[0]; }
  if (newStatus) update.status = newStatus;

  const { data, error } = await supabase.from("portfolio_positions").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ position: data });
}
