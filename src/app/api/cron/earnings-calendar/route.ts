import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/earnings-calendar — flags stocks with upcoming earnings (catalyst detection)
const CRON_SECRET = process.env.CRON_SECRET || "";
const LOOKAHEAD_DAYS = 14;

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

interface EarningsInfo {
  symbol: string;
  earningsDate: string | null;
  daysUntil: number | null;
  isUpcoming: boolean;
}

async function getEarningsDate(symbol: string): Promise<string | null> {
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const result = await yf.quoteSummary(symbol, { modules: ["earnings", "calendarEvents"] });
    const cal = result.calendarEvents;
    if (cal?.earnings?.earningsDate?.[0]) {
      return new Date(cal.earnings.earningsDate[0]).toISOString().split("T")[0];
    }
    return null;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = trySupabase();
  let symbols: string[];
  if (supabase) {
    const { data } = await supabase.from("watchlists").select("symbol").eq("active", true);
    symbols = (data || []).map((r: { symbol: string }) => r.symbol);
  } else {
    symbols = (process.env.WATCHLIST || "NASDAQ:NVDA,NASDAQ:TSLA,NASDAQ:AAPL").split(",");
  }

  const now = Date.now();
  const results: EarningsInfo[] = [];

  for (const symbol of symbols) {
    const raw = symbol.includes(":") ? symbol.split(":")[1] : symbol;
    const yahooSymbol = symbol.startsWith("TWSE:") ? `${raw}.TW` : raw;
    const earningsDate = await getEarningsDate(yahooSymbol);

    let daysUntil: number | null = null;
    let isUpcoming = false;

    if (earningsDate) {
      daysUntil = Math.round((new Date(earningsDate).getTime() - now) / 86400000);
      isUpcoming = daysUntil >= 0 && daysUntil <= LOOKAHEAD_DAYS;
    }

    results.push({ symbol, earningsDate, daysUntil, isUpcoming });
  }

  const upcoming = results.filter(r => r.isUpcoming).sort((a, b) => (a.daysUntil || 99) - (b.daysUntil || 99));

  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    lookaheadDays: LOOKAHEAD_DAYS,
    upcoming,
    all: results,
    summary: upcoming.length > 0
      ? `📅 Earnings in ${LOOKAHEAD_DAYS}d: ${upcoming.map(r => `${r.symbol}(${r.daysUntil}d)`).join(", ")}`
      : `📅 No earnings in next ${LOOKAHEAD_DAYS} days`,
  });
}
