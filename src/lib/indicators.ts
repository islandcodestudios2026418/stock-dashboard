export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function calcSMA(data: number[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

export function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

export function calcMACD(closes: number[]) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const dif = ema12.map((v, i) => v - ema26[i]);
  const dea = calcEMA(dif, 9);
  const histogram = dif.map((v, i) => (v - dea[i]) * 2);
  return { dif, dea, histogram };
}

export function calcRSI(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = [null];
  for (let i = 1; i < closes.length; i++) {
    if (i < period) { result.push(null); continue; }
    let gains = 0, losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    const rs = losses === 0 ? 100 : gains / losses;
    result.push(100 - 100 / (1 + rs));
  }
  return result;
}

export function calcBOLL(closes: number[], period = 20, mult = 2) {
  const mid = calcSMA(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (mid[i] === null) { upper.push(null); lower.push(null); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mid[i]!) ** 2, 0) / period);
    upper.push(mid[i]! + mult * std);
    lower.push(mid[i]! - mult * std);
  }
  return { mid, upper, lower };
}

export function calcKDJ(data: OHLCV[], period = 9) {
  const k: number[] = [], d: number[] = [], j: number[] = [];
  let prevK = 50, prevD = 50;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { k.push(50); d.push(50); j.push(50); continue; }
    const slice = data.slice(i - period + 1, i + 1);
    const low = Math.min(...slice.map(s => s.low));
    const high = Math.max(...slice.map(s => s.high));
    const rsv = high === low ? 50 : ((data[i].close - low) / (high - low)) * 100;
    const curK = (2 / 3) * prevK + (1 / 3) * rsv;
    const curD = (2 / 3) * prevD + (1 / 3) * curK;
    const curJ = 3 * curK - 2 * curD;
    k.push(curK); d.push(curD); j.push(curJ);
    prevK = curK; prevD = curD;
  }
  return { k, d, j };
}

export type IndicatorStatus = "bullish" | "neutral" | "bearish";

export function getIndicatorSummary(data: OHLCV[]) {
  const closes = data.map(d => d.close);
  const last = closes.length - 1;
  const macd = calcMACD(closes);
  const rsi = calcRSI(closes);
  const kdj = calcKDJ(data);
  const sma20 = calcSMA(closes, 20);

  const macdStatus: IndicatorStatus = macd.dif[last] > macd.dea[last] ? "bullish" : macd.dif[last] < macd.dea[last] ? "bearish" : "neutral";
  const rsiVal = rsi[last] ?? 50;
  const rsiStatus: IndicatorStatus = rsiVal > 70 ? "bullish" : rsiVal < 30 ? "bearish" : "neutral";
  const kdjStatus: IndicatorStatus = kdj.k[last] > 80 ? "bullish" : kdj.k[last] < 20 ? "bearish" : "neutral";
  const maStatus: IndicatorStatus = closes[last] > (sma20[last] ?? closes[last]) ? "bullish" : "bearish";

  const avgVol = data.slice(-20).reduce((s, d) => s + d.volume, 0) / 20;
  const volStatus: IndicatorStatus = data[last].volume > avgVol * 1.5 ? "bullish" : data[last].volume < avgVol * 0.5 ? "bearish" : "neutral";

  return {
    macd: { status: macdStatus, dif: macd.dif[last], dea: macd.dea[last] },
    rsi: { status: rsiStatus, value: rsiVal },
    kdj: { status: kdjStatus, k: kdj.k[last], d: kdj.d[last], j: kdj.j[last] },
    ma: { status: maStatus, sma20: sma20[last] },
    volume: { status: volStatus, current: data[last].volume, avg20: avgVol },
  };
}

export function calcRiskScore(data: OHLCV[]): number {
  const closes = data.map(d => d.close);
  const last = closes.length - 1;
  let score = 5;

  // Volatility
  const returns = closes.slice(-20).map((c, i, a) => i === 0 ? 0 : (c - a[i-1]) / a[i-1]);
  const vol = Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / returns.length) * Math.sqrt(252);
  if (vol > 0.5) score += 2; else if (vol > 0.3) score += 1;

  // Distance from MA20
  const sma20 = calcSMA(closes, 20);
  if (sma20[last]) {
    const dist = (closes[last] - sma20[last]!) / sma20[last]!;
    if (Math.abs(dist) > 0.1) score += 1;
  }

  // RSI extremes
  const rsi = calcRSI(closes);
  const rsiVal = rsi[last] ?? 50;
  if (rsiVal > 80 || rsiVal < 20) score += 1;

  // Recent drawdown
  const high20 = Math.max(...closes.slice(-20));
  const drawdown = (high20 - closes[last]) / high20;
  if (drawdown > 0.1) score += 1;

  return Math.min(10, Math.max(1, Math.round(score)));
}
