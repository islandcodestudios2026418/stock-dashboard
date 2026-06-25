import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";
import { calcEMA, calcBOLL, calcRSI, calcADX, type OHLCV } from "@/lib/indicators";
import { calcSupportResistance } from "@/lib/levels";

// GET /api/cron/entry-timing — detect optimal entry patterns for watchlist stocks
// Patterns: pullback to support, vol squeeze breakout, morning star reversal

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

type EntryPattern = "PULLBACK_SUPPORT" | "VOL_SQUEEZE" | "MORNING_STAR" | "BREAKOUT_RETEST" | "NONE";

function detectEntry(data: OHLCV[]): { pattern: EntryPattern; confidence: number; detail: string; entryZone: { low: number; high: number } | null } {
  if (data.length < 30) return { pattern: "NONE", confidence: 0, detail: "insufficient data", entryZone: null };

  const closes = data.map(d => d.close);
  const last = data.length - 1;
  const cur = data[last];

  // 1. Pullback to support: price pulled back to EMA21 or support level in uptrend
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const levels = calcSupportResistance(data);
  const supports = levels.filter(l => l.type === "support" && l.price < cur.close);
  const nearestSupport = supports.length > 0 ? supports[0].price : null;

  const inUptrend = ema21[last] > ema50[last] && cur.close > ema50[last];
  const pullbackToEMA = inUptrend && cur.low <= ema21[last] * 1.02 && cur.close > ema21[last] * 0.98;
  const pullbackToSupport = inUptrend && nearestSupport && cur.low <= nearestSupport * 1.03 && cur.close > nearestSupport;

  if (pullbackToEMA || pullbackToSupport) {
    const zone = pullbackToSupport && nearestSupport
      ? { low: nearestSupport, high: ema21[last] }
      : { low: ema21[last] * 0.98, high: ema21[last] };
    return { pattern: "PULLBACK_SUPPORT", confidence: pullbackToSupport ? 80 : 70, detail: pullbackToSupport ? `pullback to support $${nearestSupport!.toFixed(2)}` : `pullback to EMA21 $${ema21[last].toFixed(2)}`, entryZone: zone };
  }

  // 2. Volatility squeeze: Bollinger bands narrowing + ADX rising = imminent breakout
  const boll = calcBOLL(closes, 20, 2);
  const adx = calcADX(data, 14);
  const bandWidth = boll.upper[last] && boll.lower[last] && boll.mid[last]
    ? ((boll.upper[last]! - boll.lower[last]!) / boll.mid[last]!) * 100 : 999;
  // Compare to 20d average bandwidth
  let avgBW = 0;
  let bwCount = 0;
  for (let i = Math.max(0, last - 20); i < last; i++) {
    if (boll.upper[i] && boll.lower[i] && boll.mid[i]) {
      avgBW += ((boll.upper[i]! - boll.lower[i]!) / boll.mid[i]!) * 100;
      bwCount++;
    }
  }
  avgBW = bwCount > 0 ? avgBW / bwCount : bandWidth;
  const squeezing = bandWidth < avgBW * 0.7;
  const adxRising = adx.length >= 3 && adx[adx.length - 1] > adx[adx.length - 3];

  if (squeezing && adxRising && inUptrend) {
    return { pattern: "VOL_SQUEEZE", confidence: 75, detail: `bandwidth ${bandWidth.toFixed(1)}% vs avg ${avgBW.toFixed(1)}%, ADX rising`, entryZone: { low: cur.close * 0.98, high: boll.upper[last]! } };
  }

  // 3. Morning star / bullish reversal: 3-candle pattern after decline
  if (data.length >= 3) {
    const d3 = data[last - 2], d2 = data[last - 1], d1 = data[last];
    const bigRed = d3.close < d3.open && (d3.open - d3.close) / d3.open > 0.015;
    const smallBody = Math.abs(d2.close - d2.open) / d2.open < 0.005;
    const bigGreen = d1.close > d1.open && (d1.close - d1.open) / d1.open > 0.015;
    const gapDown = d2.high < d3.low;

    if (bigRed && smallBody && bigGreen) {
      const rsi = calcRSI(closes, 14);
      const oversold = rsi[last - 1] !== null && (rsi[last - 1] ?? 50) < 35;
      return { pattern: "MORNING_STAR", confidence: oversold ? 80 : 65, detail: `3-candle reversal${oversold ? " + RSI oversold" : ""}${gapDown ? " + gap" : ""}`, entryZone: { low: d2.low, high: d1.close } };
    }
  }

  // 4. Breakout retest: price broke above resistance, pulled back to test it as support
  const resistances = levels.filter(l => l.type === "resistance");
  for (const r of resistances.slice(0, 3)) {
    const aboveResistance = cur.close > r.price * 1.01;
    const recentlyBrokeOut = data.slice(-5).some(d => d.close < r.price) && cur.close > r.price;
    const retesting = cur.low <= r.price * 1.02 && cur.close > r.price;
    if (aboveResistance && recentlyBrokeOut && retesting) {
      return { pattern: "BREAKOUT_RETEST", confidence: 75, detail: `retesting broken resistance $${r.price.toFixed(2)}`, entryZone: { low: r.price * 0.99, high: r.price * 1.02 } };
    }
  }

  return { pattern: "NONE", confidence: 0, detail: "no clear entry pattern", entryZone: null };
}

async function fetchChart(symbol: string): Promise<OHLCV[]> {
  const mod = await import("yahoo-finance2");
  const YahooFinance = mod.default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const period1 = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];
  const result = await yf.chart(symbol, { period1, interval: "1d" });
  return (result.quotes || []).filter(q => q.close != null).map(q => ({ time: Math.floor(new Date(q.date).getTime() / 1000), open: q.open!, high: q.high!, low: q.low!, close: q.close!, volume: q.volume || 0 }));
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

  const results: { symbol: string; pattern: EntryPattern; confidence: number; detail: string; entryZone: { low: number; high: number } | null }[] = [];

  for (const sym of symbols.slice(0, 15)) {
    try {
      const raw = sym.includes(":") ? sym.split(":")[1] : sym;
      const yahoo = sym.startsWith("TWSE:") ? `${raw}.TW` : raw;
      const data = await fetchChart(yahoo);
      if (data.length < 30) continue;
      const entry = detectEntry(data);
      results.push({ symbol: raw, ...entry });
    } catch { /* skip */ }
  }

  const actionable = results.filter(r => r.pattern !== "NONE");
  actionable.sort((a, b) => b.confidence - a.confidence);

  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    scanned: results.length,
    signals: actionable,
    noEntry: results.filter(r => r.pattern === "NONE").map(r => r.symbol),
    summary: actionable.length > 0
      ? `⏱️ ${actionable.length} entry signals: ${actionable.map(a => `${a.symbol}(${a.pattern})`).join(", ")}`
      : "⚪ No clear entry patterns detected",
  });
}
