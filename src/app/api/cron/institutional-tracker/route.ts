import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";
import { calcEMA, calcADX, calcRSI, type OHLCV } from "@/lib/indicators";

// GET /api/cron/institutional-tracker — detect smart money accumulation patterns
// Wyckoff-style analysis: identifies accumulation/distribution phases using volume-price behavior
// Key patterns: narrow range bars on declining volume (accumulation), spring/shakeout, volume dry-up

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

type Phase = "ACCUMULATION" | "MARKUP" | "DISTRIBUTION" | "MARKDOWN" | "UNCLEAR";
type AccumulationSignal = "SPRING" | "VOLUME_DRYUP" | "NARROW_RANGE_ABSORPTION" | "SHAKEOUT_REVERSAL" | "BREAKOUT_ON_VOLUME" | "NONE";

interface InstitutionalResult {
  symbol: string;
  phase: Phase;
  signal: AccumulationSignal;
  confidence: number; // 0-100
  metrics: {
    volumeTrend: "INCREASING" | "DECREASING" | "FLAT"; // 30d volume vs 60d
    priceVolDivergence: boolean; // price flat/down but volume drying up = accumulation
    narrowRangeDays: number; // last 10d with range < 50% of 20d avg range
    onBalanceVolumeTrend: "RISING" | "FALLING" | "FLAT";
    upDownVolumeRatio: number; // volume on up days / volume on down days (>1.5 = accumulation)
    springDetected: boolean; // brief dip below support then reclaim
    relativeVolumeProfile: number; // recent avg vol / 60d avg vol
  };
  reasoning: string;
}

function calcOBV(data: OHLCV[]): number[] {
  const obv: number[] = [0];
  for (let i = 1; i < data.length; i++) {
    if (data[i].close > data[i - 1].close) obv.push(obv[i - 1] + data[i].volume);
    else if (data[i].close < data[i - 1].close) obv.push(obv[i - 1] - data[i].volume);
    else obv.push(obv[i - 1]);
  }
  return obv;
}

function detectPhaseAndSignal(data: OHLCV[]): InstitutionalResult & { symbol: string } {
  const n = data.length;
  if (n < 60) {
    return { symbol: "", phase: "UNCLEAR", signal: "NONE", confidence: 0, metrics: { volumeTrend: "FLAT", priceVolDivergence: false, narrowRangeDays: 0, onBalanceVolumeTrend: "FLAT", upDownVolumeRatio: 1, springDetected: false, relativeVolumeProfile: 1 }, reasoning: "insufficient data" };
  }

  const closes = data.map(d => d.close);
  const volumes = data.map(d => d.volume);
  const last = n - 1;

  // --- Metrics ---

  // 1. Volume trend: 10d avg vs 30d avg
  const vol10d = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const vol30d = volumes.slice(-30).reduce((a, b) => a + b, 0) / 30;
  const vol60d = volumes.slice(-60).reduce((a, b) => a + b, 0) / 60;
  const volumeTrend: "INCREASING" | "DECREASING" | "FLAT" =
    vol10d > vol30d * 1.3 ? "INCREASING" : vol10d < vol30d * 0.7 ? "DECREASING" : "FLAT";
  const relativeVolumeProfile = +(vol10d / vol60d).toFixed(2);

  // 2. Narrow range days (last 10 bars): range < 50% of 20d avg range
  const ranges = data.map(d => d.high - d.low);
  const avgRange20 = ranges.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const narrowRangeDays = data.slice(-10).filter(d => (d.high - d.low) < avgRange20 * 0.5).length;

  // 3. OBV trend
  const obv = calcOBV(data);
  const obvEma10 = calcEMA(obv.slice(-30), 10);
  const obvTrend: "RISING" | "FALLING" | "FLAT" =
    obvEma10.length >= 2 && obvEma10[obvEma10.length - 1] > obvEma10[obvEma10.length - 5] * 1.01 ? "RISING" :
    obvEma10.length >= 2 && obvEma10[obvEma10.length - 1] < obvEma10[obvEma10.length - 5] * 0.99 ? "FALLING" : "FLAT";

  // 4. Up/down volume ratio (last 20 days)
  let upVol = 0, downVol = 0;
  for (let i = n - 20; i < n; i++) {
    if (data[i].close > data[i - 1].close) upVol += data[i].volume;
    else downVol += data[i].volume;
  }
  const upDownVolumeRatio = downVol > 0 ? +(upVol / downVol).toFixed(2) : 99;

  // 5. Price-volume divergence: price flat/declining but volume drying up (accumulation sign)
  const priceChange20d = (closes[last] - closes[last - 20]) / closes[last - 20];
  const priceVolDivergence = Math.abs(priceChange20d) < 0.05 && volumeTrend === "DECREASING";

  // 6. Spring detection: recent dip below 20d low then immediate reclaim
  const low20d = Math.min(...data.slice(-20, -3).map(d => d.low));
  const recentDipBelow = data.slice(-5).some(d => d.low < low20d * 0.99);
  const reclaimed = closes[last] > low20d;
  const springDetected = recentDipBelow && reclaimed;

  // 7. EMA structure for phase detection
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const adx = calcADX(data, 14);
  const adxValue = adx.length > 0 ? adx[adx.length - 1] : 0;

  // --- Phase Detection ---
  let phase: Phase = "UNCLEAR";
  if (ema21[last] > ema50[last] && adxValue > 25 && priceChange20d > 0.05) {
    phase = "MARKUP";
  } else if (ema21[last] < ema50[last] && adxValue > 25 && priceChange20d < -0.05) {
    phase = "MARKDOWN";
  } else if (adxValue < 20 && priceVolDivergence && upDownVolumeRatio > 1.2) {
    phase = "ACCUMULATION";
  } else if (adxValue < 20 && upDownVolumeRatio < 0.8) {
    phase = "DISTRIBUTION";
  } else if (narrowRangeDays >= 5 && volumeTrend === "DECREASING") {
    phase = "ACCUMULATION"; // Wyckoff: tight range + low vol = institutions absorbing supply
  }

  // --- Signal Detection ---
  let signal: AccumulationSignal = "NONE";
  let confidence = 0;
  let reasoning = "";

  // Spring: dip below support + immediate recovery on increasing volume
  if (springDetected && upDownVolumeRatio > 1.3) {
    signal = "SPRING";
    confidence = 80;
    reasoning = `Price dipped below 20d support ($${low20d.toFixed(2)}) then reclaimed — classic Wyckoff spring. Up/down vol ratio: ${upDownVolumeRatio}`;
  }
  // Volume dry-up: declining volume in consolidation → accumulation complete, breakout imminent
  else if (phase === "ACCUMULATION" && volumeTrend === "DECREASING" && relativeVolumeProfile < 0.6) {
    signal = "VOLUME_DRYUP";
    confidence = 70;
    reasoning = `Volume at ${(relativeVolumeProfile * 100).toFixed(0)}% of 60d avg during sideways action — supply absorbed, breakout imminent`;
  }
  // Narrow range absorption: 5+ days of tight range on low volume = institutions quietly buying
  else if (narrowRangeDays >= 6 && volumeTrend !== "INCREASING" && obvTrend === "RISING") {
    signal = "NARROW_RANGE_ABSORPTION";
    confidence = 75;
    reasoning = `${narrowRangeDays}/10 narrow range days with rising OBV — quiet accumulation (supply drying up)`;
  }
  // Shakeout reversal: big red candle on high vol followed by recovery
  else if (n >= 3) {
    const d2 = data[last - 1];
    const d1 = data[last];
    const bigRed = d2.close < d2.open && (d2.open - d2.close) / d2.close > 0.025;
    const highVol = volumes[last - 1] > vol30d * 2;
    const recovery = d1.close > d2.open; // recovered full previous candle
    if (bigRed && highVol && recovery) {
      signal = "SHAKEOUT_REVERSAL";
      confidence = 75;
      reasoning = `Large red candle on ${(volumes[last - 1] / vol30d).toFixed(1)}x volume, fully recovered next day — institutional shakeout then buy`;
    }
  }

  // Breakout on volume: price breaks above 20d high on elevated volume
  if (signal === "NONE") {
    const high20d = Math.max(...closes.slice(-20, -1));
    const breakingOut = closes[last] > high20d * 1.01;
    const onVolume = volumes[last] > vol30d * 1.5;
    if (breakingOut && onVolume && phase !== "MARKDOWN") {
      signal = "BREAKOUT_ON_VOLUME";
      confidence = 70;
      reasoning = `Breaking above 20d high ($${high20d.toFixed(2)}) on ${(volumes[last] / vol30d).toFixed(1)}x avg volume — institutional demand confirmed`;
    }
  }

  if (signal === "NONE") {
    if (phase === "ACCUMULATION") {
      confidence = 40;
      reasoning = `In accumulation phase (ADX=${adxValue.toFixed(0)}, vol declining, up/down ratio ${upDownVolumeRatio}) but no specific trigger yet`;
    } else {
      reasoning = `Phase: ${phase}, ADX=${adxValue.toFixed(0)}, vol trend: ${volumeTrend}. No accumulation signal.`;
    }
  }

  const metrics = {
    volumeTrend, priceVolDivergence, narrowRangeDays,
    onBalanceVolumeTrend: obvTrend, upDownVolumeRatio,
    springDetected, relativeVolumeProfile,
  };

  return { symbol: "", phase, signal, confidence, metrics, reasoning };
}

async function fetchChart(symbol: string): Promise<OHLCV[]> {
  const mod = await import("yahoo-finance2");
  const YahooFinance = mod.default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const period1 = new Date(Date.now() - 120 * 86400000).toISOString().split("T")[0];
  const result = await yf.chart(symbol, { period1, interval: "1d" });
  return (result.quotes || []).filter(q => q.close != null).map(q => ({
    time: Math.floor(new Date(q.date).getTime() / 1000),
    open: q.open!, high: q.high!, low: q.low!, close: q.close!, volume: q.volume || 0,
  }));
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

  const results: InstitutionalResult[] = [];

  for (const sym of symbols.slice(0, 15)) {
    try {
      const raw = sym.includes(":") ? sym.split(":")[1] : sym;
      const yahoo = sym.startsWith("TWSE:") ? `${raw}.TW` : raw;
      const data = await fetchChart(yahoo);
      if (data.length < 60) continue;

      const result = detectPhaseAndSignal(data);
      result.symbol = raw;
      results.push(result);
    } catch { /* skip */ }
  }

  const accumulating = results.filter(r => r.phase === "ACCUMULATION" || r.signal !== "NONE");
  accumulating.sort((a, b) => b.confidence - a.confidence);

  const distributing = results.filter(r => r.phase === "DISTRIBUTION");

  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    scanned: results.length,
    accumulating: accumulating.filter(r => r.signal !== "NONE"),
    distributing: distributing.map(r => ({ symbol: r.symbol, phase: r.phase, reasoning: r.reasoning })),
    all: results,
    summary: accumulating.filter(r => r.signal !== "NONE").length > 0
      ? `🏦 Smart money: ${accumulating.filter(r => r.signal !== "NONE").map(r => `${r.symbol}(${r.signal})`).join(", ")}`
      : `⚪ No clear institutional accumulation patterns`,
    phaseBreakdown: {
      accumulation: results.filter(r => r.phase === "ACCUMULATION").length,
      markup: results.filter(r => r.phase === "MARKUP").length,
      distribution: results.filter(r => r.phase === "DISTRIBUTION").length,
      markdown: results.filter(r => r.phase === "MARKDOWN").length,
      unclear: results.filter(r => r.phase === "UNCLEAR").length,
    },
  });
}
