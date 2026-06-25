import { NextRequest, NextResponse } from "next/server";

// GET /api/cron/market-breadth — broad market health indicators
// Checks major indices + breadth proxies to determine if it's a good time to be long.

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

async function fetchQuote(symbol: string): Promise<{ price: number; change: number; pctChange: number } | null> {
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const q = await yf.quote(symbol);
    return {
      price: q.regularMarketPrice ?? 0,
      change: q.regularMarketChange ?? 0,
      pctChange: q.regularMarketChangePercent ?? 0,
    };
  } catch { return null; }
}

async function fetchAbove200MA(symbol: string): Promise<boolean | null> {
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const period1 = new Date(Date.now() - 250 * 86400000).toISOString().split("T")[0];
    const result = await yf.chart(symbol, { period1, interval: "1d" });
    const closes = (result.quotes || []).filter(q => q.close != null).map(q => q.close!);
    if (closes.length < 200) return null;
    const sma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
    return closes[closes.length - 1] > sma200;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch major indices
  const indices = ["^GSPC", "^IXIC", "^DJI", "^RUT"]; // SPX, NDX, DJI, Russell 2000
  const indicesData: { symbol: string; name: string; price: number; pctChange: number }[] = [];
  const names: Record<string, string> = { "^GSPC": "S&P 500", "^IXIC": "NASDAQ", "^DJI": "Dow Jones", "^RUT": "Russell 2000" };

  for (const idx of indices) {
    const q = await fetchQuote(idx);
    if (q) indicesData.push({ symbol: idx, name: names[idx], price: +q.price.toFixed(2), pctChange: +q.pctChange.toFixed(2) });
  }

  // Breadth proxies: % of S&P 500 stocks above 200MA (use sector ETFs as proxy)
  const sectorETFs = ["XLK", "XLF", "XLV", "XLE", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC"];
  let above200 = 0;
  let total = 0;
  for (const etf of sectorETFs) {
    const result = await fetchAbove200MA(etf);
    if (result !== null) { total++; if (result) above200++; }
  }
  const pctAbove200 = total > 0 ? +((above200 / total) * 100).toFixed(0) : null;

  // Advance/Decline proxy: how many sector ETFs are green today
  let advancing = 0;
  for (const etf of sectorETFs) {
    const q = await fetchQuote(etf);
    if (q && q.pctChange > 0) advancing++;
  }
  const advDecl = total > 0 ? `${advancing}/${total}` : "N/A";

  // Market regime based on breadth
  let regime: string;
  let signal: string;
  if (pctAbove200 !== null && pctAbove200 >= 80) { regime = "STRONG"; signal = "🟢 Broad participation — market supports longs"; }
  else if (pctAbove200 !== null && pctAbove200 >= 50) { regime = "NORMAL"; signal = "🟡 Mixed breadth — be selective"; }
  else { regime = "WEAK"; signal = "🔴 Poor breadth — avoid new longs, defensive stance"; }

  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    indices: indicesData,
    breadth: { sectorsAbove200MA: `${above200}/${total}`, pctAbove200, advancingToday: advDecl },
    regime,
    signal,
  });
}
