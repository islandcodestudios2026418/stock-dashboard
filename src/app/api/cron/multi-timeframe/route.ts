import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";
import { calcEMA, calcSMA, calcMACD, calcRSI, calcADX, type OHLCV } from "@/lib/indicators";

// GET /api/cron/multi-timeframe — weekly + monthly trend overlay on daily signals
// Prevents taking daily breakout trades against the higher-timeframe trend.

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

function aggregateToWeekly(daily: OHLCV[]): OHLCV[] {
  const weeks: OHLCV[] = [];
  let current: OHLCV | null = null;
  for (const d of daily) {
    const date = new Date(d.time * 1000);
    const dow = date.getUTCDay();
    if (!current || dow === 1) { // Monday starts new week
      if (current) weeks.push(current);
      current = { ...d };
    } else {
      current.high = Math.max(current.high, d.high);
      current.low = Math.min(current.low, d.low);
      current.close = d.close;
      current.volume += d.volume;
    }
  }
  if (current) weeks.push(current);
  return weeks;
}

function aggregateToMonthly(daily: OHLCV[]): OHLCV[] {
  const months: OHLCV[] = [];
  let current: OHLCV | null = null;
  let curMonth = -1;
  for (const d of daily) {
    const m = new Date(d.time * 1000).getUTCMonth();
    if (m !== curMonth) {
      if (current) months.push(current);
      current = { ...d };
      curMonth = m;
    } else if (current) {
      current.high = Math.max(current.high, d.high);
      current.low = Math.min(current.low, d.low);
      current.close = d.close;
      current.volume += d.volume;
    }
  }
  if (current) months.push(current);
  return months;
}

type Trend = "BULLISH" | "BEARISH" | "NEUTRAL";

function analyzeTrend(data: OHLCV[]): { trend: Trend; strength: number; detail: string } {
  if (data.length < 5) return { trend: "NEUTRAL", strength: 0, detail: "insufficient data" };
  const closes = data.map(d => d.close);
  const last = closes.length - 1;
  const ema20 = calcEMA(closes, Math.min(20, last));
  const sma50 = calcSMA(closes, Math.min(50, last));
  const adx = calcADX(data, 14);
  const rsi = calcRSI(closes, 14);
  const macd = calcMACD(closes);

  let score = 0;
  const reasons: string[] = [];

  if (closes[last] > ema20[last]) { score += 1; reasons.push("price>EMA20"); }
  else { score -= 1; reasons.push("price<EMA20"); }

  const sma50Last = sma50[last];
  if (sma50Last != null && closes[last] > sma50Last) { score += 1; reasons.push("price>SMA50"); }
  else { score -= 1; reasons.push("price<SMA50"); }

  if (macd.dif[last] > macd.dea[last]) { score += 1; reasons.push("MACD bullish"); }
  else { score -= 1; reasons.push("MACD bearish"); }

  const adxLast = adx[adx.length - 1] || 0;
  const rsiLast = rsi[rsi.length - 1] ?? 50;
  const strength = Math.min(100, adxLast * 2 + Math.abs(rsiLast - 50));

  const trend: Trend = score >= 2 ? "BULLISH" : score <= -2 ? "BEARISH" : "NEUTRAL";
  return { trend, strength: +strength.toFixed(0), detail: reasons.join(", ") };
}

async function fetchDailyData(symbol: string, days: number): Promise<OHLCV[]> {
  const mod = await import("yahoo-finance2");
  const YahooFinance = mod.default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const period1 = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
  const result = await yf.chart(symbol, { period1, interval: "1d" });
  return (result.quotes || [])
    .filter(q => q.close != null)
    .map(q => ({ time: Math.floor(new Date(q.date).getTime() / 1000), open: q.open!, high: q.high!, low: q.low!, close: q.close!, volume: q.volume || 0 }));
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const symbol = req.nextUrl.searchParams.get("symbol");

  const supabase = trySupabase();
  let symbols: string[] = symbol ? [symbol] : [];
  if (symbols.length === 0 && supabase) {
    const { data } = await supabase.from("watchlists").select("symbol").eq("active", true);
    symbols = (data || []).map((r: { symbol: string }) => r.symbol);
  }
  if (symbols.length === 0) symbols = (process.env.WATCHLIST || "NASDAQ:NVDA").split(",");

  const results: { symbol: string; daily: { trend: Trend; strength: number; detail: string }; weekly: { trend: Trend; strength: number; detail: string }; monthly: { trend: Trend; strength: number; detail: string }; alignment: string; actionable: boolean }[] = [];

  for (const sym of symbols.slice(0, 10)) {
    try {
      const raw = sym.includes(":") ? sym.split(":")[1] : sym;
      const yahoo = sym.startsWith("TWSE:") ? `${raw}.TW` : raw;
      const daily = await fetchDailyData(yahoo, 365);
      if (daily.length < 30) continue;

      const dailyTrend = analyzeTrend(daily.slice(-60));
      const weekly = aggregateToWeekly(daily);
      const weeklyTrend = analyzeTrend(weekly);
      const monthly = aggregateToMonthly(daily);
      const monthlyTrend = analyzeTrend(monthly);

      // Alignment: all timeframes agree = strong signal
      const trends = [dailyTrend.trend, weeklyTrend.trend, monthlyTrend.trend];
      const allBull = trends.every(t => t === "BULLISH");
      const allBear = trends.every(t => t === "BEARISH");
      const alignment = allBull ? "🟢 ALL BULLISH" : allBear ? "🔴 ALL BEARISH" : "⚠️ MIXED";
      // Actionable = daily bullish and higher TF supports it
      const actionable = dailyTrend.trend === "BULLISH" && weeklyTrend.trend !== "BEARISH" && monthlyTrend.trend !== "BEARISH";

      results.push({ symbol: raw, daily: dailyTrend, weekly: weeklyTrend, monthly: monthlyTrend, alignment, actionable });
    } catch { /* skip failed symbols */ }
  }

  const aligned = results.filter(r => r.actionable);
  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    results,
    actionableSymbols: aligned.map(r => r.symbol),
    summary: `${aligned.length}/${results.length} symbols have multi-TF bullish alignment`,
  });
}
