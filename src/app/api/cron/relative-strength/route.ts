import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/relative-strength — computes IBD-style RS rating vs SPY
// RS = percentile rank of stock's performance vs S&P 500 over 60 days
const CRON_SECRET = process.env.CRON_SECRET || "";
const RS_PERIOD = 60; // days

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

async function fetchPerformance(symbol: string, days: number): Promise<number | null> {
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const period1 = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
    const result = await yf.chart(symbol, { period1, interval: "1d" });
    const quotes = (result.quotes || []).filter(q => q.close != null);
    if (quotes.length < 10) return null;
    const first = quotes[0].close!;
    const last = quotes[quotes.length - 1].close!;
    return ((last - first) / first) * 100;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = trySupabase();
  // Get watchlist symbols
  let symbols: string[];
  if (supabase) {
    const { data } = await supabase.from("watchlists").select("symbol").eq("active", true);
    symbols = (data || []).map((r: { symbol: string }) => r.symbol);
  } else {
    symbols = (process.env.WATCHLIST || "NASDAQ:NVDA,NASDAQ:TSLA,NASDAQ:AAPL").split(",");
  }

  // Fetch SPY benchmark performance
  const spyPerf = await fetchPerformance("SPY", RS_PERIOD);
  if (spyPerf === null) return NextResponse.json({ error: "Failed to fetch SPY data" }, { status: 503 });

  // Fetch each stock's performance
  const rankings: { symbol: string; perf: number; relStrength: number; rsRating: number; outperforms: boolean }[] = [];

  for (const symbol of symbols) {
    const raw = symbol.includes(":") ? symbol.split(":")[1] : symbol;
    const yahooSymbol = symbol.startsWith("TWSE:") ? `${raw}.TW` : raw;
    const perf = await fetchPerformance(yahooSymbol, RS_PERIOD);
    if (perf === null) continue;

    const relStrength = perf - spyPerf; // relative performance vs SPY
    rankings.push({ symbol, perf: Math.round(perf * 100) / 100, relStrength: Math.round(relStrength * 100) / 100, rsRating: 0, outperforms: relStrength > 0 });
  }

  // Compute percentile rank (IBD RS Rating style: 1-99)
  rankings.sort((a, b) => a.relStrength - b.relStrength);
  rankings.forEach((r, i) => {
    r.rsRating = Math.max(1, Math.min(99, Math.round(((i + 1) / rankings.length) * 99)));
  });

  // Sort by RS rating descending for output
  rankings.sort((a, b) => b.rsRating - a.rsRating);

  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    benchmark: { symbol: "SPY", performance: Math.round(spyPerf * 100) / 100, period: `${RS_PERIOD}d` },
    rankings,
    leaders: rankings.filter(r => r.rsRating >= 80).map(r => r.symbol),
    laggards: rankings.filter(r => r.rsRating <= 20).map(r => r.symbol),
  });
}
