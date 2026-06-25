import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";
import { calcEMA, calcRSI, calcMACD, type OHLCV } from "@/lib/indicators";

// GET /api/cron/exit-signals — detect when to close open positions
// Patterns: climax volume, bearish divergence, breakdown below support, exhaustion gap

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

type ExitSignal = "CLIMAX_VOLUME" | "BEARISH_DIVERGENCE" | "BREAKDOWN" | "EXHAUSTION_GAP" | "NONE";

function detectExit(data: OHLCV[]): { signal: ExitSignal; urgency: number; detail: string } {
  if (data.length < 20) return { signal: "NONE", urgency: 0, detail: "insufficient data" };

  const closes = data.map(d => d.close);
  const volumes = data.map(d => d.volume);
  const last = data.length - 1;

  // 1. Climax volume: volume spike >3x 20d average + wide range candle at highs
  const avgVol20 = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  const lastVol = volumes[last];
  const wideRange = (data[last].high - data[last].low) / data[last].close > 0.03;
  const atHighs = closes[last] >= Math.max(...closes.slice(-20));
  const redCandle = data[last].close < data[last].open;

  if (lastVol > avgVol20 * 3 && wideRange && atHighs && redCandle) {
    return { signal: "CLIMAX_VOLUME", urgency: 90, detail: `vol ${(lastVol / avgVol20).toFixed(1)}x avg + wide red at highs — distribution day` };
  }

  // 2. Bearish divergence: price making new high but RSI/MACD making lower high
  const rsi = calcRSI(closes, 14);
  const macd = calcMACD(closes);
  // Check last 10 days for divergence
  const recentHigh = Math.max(...closes.slice(-10));
  const prevHigh = Math.max(...closes.slice(-20, -10));
  const priceNewHigh = recentHigh > prevHigh;

  if (priceNewHigh) {
    const recentHighIdx = closes.slice(-10).findIndex(c => c === recentHigh) + (last - 9);
    const prevHighIdx = closes.slice(-20, -10).findIndex(c => c === prevHigh) + (last - 19);
    const rsiAtRecent = rsi[recentHighIdx] ?? 50;
    const rsiAtPrev = rsi[prevHighIdx] ?? 50;
    const macdAtRecent = macd.histogram[recentHighIdx];
    const macdAtPrev = macd.histogram[prevHighIdx];

    if (rsiAtRecent < rsiAtPrev - 5 || macdAtRecent < macdAtPrev) {
      return { signal: "BEARISH_DIVERGENCE", urgency: 70, detail: `price new high but RSI/MACD lower — momentum fading` };
    }
  }

  // 3. Breakdown: close below EMA21 after extended uptrend (EMA21 was support)
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const wasAboveEMA21 = closes.slice(-10, -1).every(c => c > ema21[closes.indexOf(c)] * 0.99);
  const nowBelow = closes[last] < ema21[last] && closes[last] < data[last].open;
  const trendup = ema21[last] > ema50[last];

  if (wasAboveEMA21 && nowBelow && trendup) {
    return { signal: "BREAKDOWN", urgency: 75, detail: `broke below EMA21 ($${ema21[last].toFixed(2)}) after 10d above — support lost` };
  }

  // 4. Exhaustion gap: gap up on high volume then reversal (filled same day)
  if (data.length >= 2) {
    const prev = data[last - 1];
    const gapUp = data[last].open > prev.high * 1.01;
    const filled = data[last].close < prev.high; // gap filled
    const highVol = lastVol > avgVol20 * 2;

    if (gapUp && filled && highVol) {
      return { signal: "EXHAUSTION_GAP", urgency: 80, detail: `gap up + fill on ${(lastVol / avgVol20).toFixed(1)}x vol — exhaustion` };
    }
  }

  return { signal: "NONE", urgency: 0, detail: "no exit signal" };
}

async function fetchChart(symbol: string): Promise<OHLCV[]> {
  const mod = await import("yahoo-finance2");
  const YahooFinance = mod.default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const period1 = new Date(Date.now() - 60 * 86400000).toISOString().split("T")[0];
  const result = await yf.chart(symbol, { period1, interval: "1d" });
  return (result.quotes || []).filter(q => q.close != null).map(q => ({ time: Math.floor(new Date(q.date).getTime() / 1000), open: q.open!, high: q.high!, low: q.low!, close: q.close!, volume: q.volume || 0 }));
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  // Only check open positions (we care about when to exit)
  const { data: positions } = await supabase
    .from("portfolio_positions")
    .select("symbol, entry_price, shares, entry_date")
    .eq("status", "open");

  if (!positions || positions.length === 0) {
    return NextResponse.json({ message: "No open positions to check for exit signals", signals: [] });
  }

  const signals: { symbol: string; signal: ExitSignal; urgency: number; detail: string; entryPrice: number; currentPrice?: number }[] = [];

  for (const pos of positions) {
    const raw = pos.symbol.includes(":") ? pos.symbol.split(":")[1] : pos.symbol;
    const yahoo = pos.symbol.startsWith("TWSE:") ? `${raw}.TW` : raw;
    try {
      const data = await fetchChart(yahoo);
      if (data.length < 20) continue;
      const exit = detectExit(data);
      signals.push({ symbol: raw, ...exit, entryPrice: pos.entry_price, currentPrice: data[data.length - 1]?.close });
    } catch { /* skip */ }
  }

  const actionable = signals.filter(s => s.signal !== "NONE");
  actionable.sort((a, b) => b.urgency - a.urgency);

  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    positions: positions.length,
    signals: actionable,
    safe: signals.filter(s => s.signal === "NONE").map(s => s.symbol),
    summary: actionable.length > 0
      ? `🚨 ${actionable.length} exit signal(s): ${actionable.map(a => `${a.symbol}(${a.signal}, ${a.urgency}%)`).join(", ")}`
      : "✅ No exit signals — all positions healthy",
  });
}
