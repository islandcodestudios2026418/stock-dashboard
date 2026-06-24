import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

const CRON_SECRET = process.env.CRON_SECRET || "";
const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

// GET /api/cron/screener — discover high-momentum stocks from broader universe
// Uses Yahoo Finance screener (most active + top gainers)
export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mod = await import("yahoo-finance2");
  const YahooFinance = mod.default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

  const candidates: { symbol: string; reason: string; change: number }[] = [];

  try {
    // Top gainers from US market — use yahoo-finance2 screener
    const gainers = await yf.screener({ scrIds: "day_gainers", count: 20 });
    const quotes = (gainers as { quotes?: { symbol: string; regularMarketChangePercent: number; regularMarketVolume: number }[] }).quotes || [];
    for (const q of quotes) {
      if (q.regularMarketChangePercent > 5 && q.regularMarketVolume > 1_000_000) {
        candidates.push({ symbol: `NASDAQ:${q.symbol}`, reason: `+${q.regularMarketChangePercent.toFixed(1)}% 放量`, change: q.regularMarketChangePercent });
      }
    }
  } catch { /* screener may fail */ }

  // Also check most active (high volume = institutional attention)
  try {
    const active = await yf.screener({ scrIds: "most_actives", count: 20 });
    const quotes = (active as { quotes?: { symbol: string; regularMarketChangePercent: number; regularMarketVolume: number }[] }).quotes || [];
    for (const q of quotes) {
      if (q.regularMarketChangePercent > 3 && !candidates.find(c => c.symbol.includes(q.symbol))) {
        candidates.push({ symbol: `NASDAQ:${q.symbol}`, reason: `量能異常+${q.regularMarketChangePercent.toFixed(1)}%`, change: q.regularMarketChangePercent });
      }
    }
  } catch { /* non-critical */ }

  // Auto-add top 5 to watchlist (if Supabase available)
  const supabase = trySupabase();
  const autoAdded: string[] = [];
  if (supabase && candidates.length > 0) {
    const top = candidates.sort((a, b) => b.change - a.change).slice(0, 5);
    for (const c of top) {
      const { error } = await supabase.from("watchlists")
        .upsert({ symbol: c.symbol, name: c.reason, active: true }, { onConflict: "symbol" });
      if (!error) autoAdded.push(c.symbol);
    }
  }

  return NextResponse.json({ candidates: candidates.slice(0, 20), autoAdded, scannedAt: new Date().toISOString() });
}
