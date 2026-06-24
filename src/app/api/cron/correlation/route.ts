import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/correlation — shows which watchlist stocks are correlated
// Helps avoid taking multiple correlated positions (violates diversification rule)
const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

function calcCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 10) return 0;
  const ax = a.slice(-n), bx = b.slice(-n);
  const meanA = ax.reduce((s, v) => s + v, 0) / n;
  const meanB = bx.reduce((s, v) => s + v, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = ax[i] - meanA, db = bx[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

async function fetchReturns(symbol: string, days: number): Promise<number[] | null> {
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const period1 = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
    const result = await yf.chart(symbol, { period1, interval: "1d" });
    const closes = (result.quotes || []).filter(q => q.close != null).map(q => q.close!);
    if (closes.length < 20) return null;
    // Convert to daily returns
    return closes.slice(1).map((c, i) => (c - closes[i]) / closes[i]);
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

  // Fetch 60d daily returns for each symbol
  const returnData: Record<string, number[]> = {};
  for (const symbol of symbols) {
    const raw = symbol.includes(":") ? symbol.split(":")[1] : symbol;
    const yahoo = symbol.startsWith("TWSE:") ? `${raw}.TW` : raw;
    const returns = await fetchReturns(yahoo, 60);
    if (returns) returnData[raw] = returns;
  }

  const names = Object.keys(returnData);
  // Compute pairwise correlations
  const pairs: { a: string; b: string; correlation: number }[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const corr = calcCorrelation(returnData[names[i]], returnData[names[j]]);
      pairs.push({ a: names[i], b: names[j], correlation: Math.round(corr * 1000) / 1000 });
    }
  }

  pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  // Flag highly correlated pairs (>0.7) as risk
  const highCorr = pairs.filter(p => Math.abs(p.correlation) > 0.7);
  const diversified = pairs.filter(p => Math.abs(p.correlation) < 0.3);

  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    symbols: names,
    pairs: pairs.slice(0, 20), // top 20 most correlated
    highCorrelation: highCorr,
    diversified: diversified.slice(0, 5),
    warning: highCorr.length > 0
      ? `⚠️ ${highCorr.length} highly correlated pairs — avoid holding both simultaneously`
      : "✅ No highly correlated pairs in watchlist",
  });
}
