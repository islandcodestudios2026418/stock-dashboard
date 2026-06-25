import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/gap-scanner — detect pre-market gaps >3% on watchlist stocks
// Gap-ups often precede explosive moves (earnings, news catalysts).

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

async function getQuote(symbol: string): Promise<{ regularMarketPrice: number; regularMarketPreviousClose: number; preMarketPrice?: number; preMarketChangePercent?: number; shortName?: string } | null> {
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const q = await yf.quote(symbol);
    return {
      regularMarketPrice: q.regularMarketPrice ?? 0,
      regularMarketPreviousClose: q.regularMarketPreviousClose ?? 0,
      preMarketPrice: q.preMarketPrice ?? undefined,
      preMarketChangePercent: q.preMarketChangePercent ?? undefined,
      shortName: q.shortName ?? symbol,
    };
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const threshold = parseFloat(req.nextUrl.searchParams.get("threshold") || "3");
  const supabase = trySupabase();
  let symbols: string[];
  if (supabase) {
    const { data } = await supabase.from("watchlists").select("symbol").eq("active", true);
    symbols = (data || []).map((r: { symbol: string }) => r.symbol);
  } else {
    symbols = (process.env.WATCHLIST || "NASDAQ:NVDA,NASDAQ:TSLA,NASDAQ:AAPL").split(",");
  }

  const gaps: { symbol: string; name: string; prevClose: number; current: number; gapPct: number; isPreMarket: boolean }[] = [];

  for (const sym of symbols) {
    const raw = sym.includes(":") ? sym.split(":")[1] : sym;
    const yahoo = sym.startsWith("TWSE:") ? `${raw}.TW` : raw;
    const q = await getQuote(yahoo);
    if (!q) continue;

    // Check pre-market gap first, then regular market gap
    let gapPct: number;
    let current: number;
    let isPreMarket = false;

    if (q.preMarketPrice && q.preMarketPrice > 0) {
      gapPct = ((q.preMarketPrice - q.regularMarketPreviousClose) / q.regularMarketPreviousClose) * 100;
      current = q.preMarketPrice;
      isPreMarket = true;
    } else {
      gapPct = ((q.regularMarketPrice - q.regularMarketPreviousClose) / q.regularMarketPreviousClose) * 100;
      current = q.regularMarketPrice;
    }

    if (Math.abs(gapPct) >= threshold) {
      gaps.push({ symbol: raw, name: q.shortName || raw, prevClose: q.regularMarketPreviousClose, current: +current.toFixed(2), gapPct: +gapPct.toFixed(2), isPreMarket });
    }
  }

  gaps.sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct));

  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    threshold,
    scanned: symbols.length,
    gaps,
    summary: gaps.length > 0
      ? `🔔 ${gaps.length} gap${gaps.length > 1 ? "s" : ""} detected: ${gaps.map(g => `${g.symbol} ${g.gapPct > 0 ? "+" : ""}${g.gapPct}%`).join(", ")}`
      : "✅ No significant gaps on watchlist",
  });
}
