import { OHLCV } from "./indicators";

export interface PriceLevel {
  price: number;
  type: "support" | "resistance";
  strength: "strong" | "moderate" | "weak";
  volume: number;
  touches: number;
}

export interface TradePlan {
  stopLoss: number;
  target1: number;
  target2: number;
  riskReward: number;
  entry: number;
}

/**
 * Calculate support/resistance levels from:
 * 1. Volume Profile (recent-weighted)
 * 2. Swing High/Low (5-bar)
 * 3. Multi-touch validation
 * 4. K-line reversal pattern confirmation
 */
export function calcSupportResistance(data: OHLCV[]): PriceLevel[] {
  if (data.length < 30) return [];

  const latest = data[data.length - 1].close;
  const levels: PriceLevel[] = [];

  // --- 1. Volume Profile with recency weighting ---
  const prices = data.map(d => d.close);
  const min = Math.min(...prices) * 0.98;
  const max = Math.max(...prices) * 1.02;
  const bins = 40;
  const binSize = (max - min) / bins;
  const volumeProfile: { price: number; volume: number }[] = [];

  for (let i = 0; i < bins; i++) {
    const binLow = min + i * binSize;
    const binHigh = binLow + binSize;
    const binMid = (binLow + binHigh) / 2;
    let vol = 0;
    for (let j = 0; j < data.length; j++) {
      if (data[j].close >= binLow && data[j].close < binHigh) {
        // Recency weight: last 60 bars get 3x, last 120 get 2x, rest 1x
        const age = data.length - 1 - j;
        const weight = age < 60 ? 3 : age < 120 ? 2 : 1;
        vol += data[j].volume * weight;
      }
    }
    volumeProfile.push({ price: binMid, volume: vol });
  }

  // Find high-volume nodes (top 25%)
  const sortedVols = [...volumeProfile].sort((a, b) => b.volume - a.volume);
  const threshold = sortedVols[Math.floor(bins * 0.25)]?.volume || 0;

  for (const node of volumeProfile) {
    if (node.volume >= threshold) {
      const type = node.price < latest ? "support" : "resistance";
      const strength = node.volume >= sortedVols[2]?.volume ? "strong"
        : node.volume >= sortedVols[5]?.volume ? "moderate" : "weak";
      levels.push({ price: node.price, type, volume: node.volume, strength, touches: 0 });
    }
  }

  // --- 2. Swing High/Low with 5-bar lookback ---
  for (let i = 5; i < data.length - 5; i++) {
    const isSwingHigh = data[i].high >= data[i-1].high && data[i].high >= data[i-2].high
      && data[i].high >= data[i-3].high && data[i].high >= data[i-4].high && data[i].high >= data[i-5].high
      && data[i].high >= data[i+1].high && data[i].high >= data[i+2].high
      && data[i].high >= data[i+3].high && data[i].high >= data[i+4].high && data[i].high >= data[i+5].high;
    const isSwingLow = data[i].low <= data[i-1].low && data[i].low <= data[i-2].low
      && data[i].low <= data[i-3].low && data[i].low <= data[i-4].low && data[i].low <= data[i-5].low
      && data[i].low <= data[i+1].low && data[i].low <= data[i+2].low
      && data[i].low <= data[i+3].low && data[i].low <= data[i+4].low && data[i].low <= data[i+5].low;

    if (isSwingHigh) {
      const type = data[i].high > latest ? "resistance" : "support";
      levels.push({ price: data[i].high, type, strength: "moderate", volume: data[i].volume, touches: 0 });
    }
    if (isSwingLow) {
      const type = data[i].low < latest ? "support" : "resistance";
      levels.push({ price: data[i].low, type, strength: "moderate", volume: data[i].volume, touches: 0 });
    }
  }

  // --- 3. Deduplicate + Multi-touch validation ---
  const merged: PriceLevel[] = [];
  const sorted = levels.sort((a, b) => a.price - b.price);
  for (const level of sorted) {
    const existing = merged.find(m => Math.abs(m.price - level.price) / level.price < 0.015);
    if (existing) {
      existing.touches++;
      if (level.volume > existing.volume) {
        existing.volume = level.volume;
        existing.strength = level.strength;
      }
    } else {
      merged.push({ ...level, touches: 1 });
    }
  }

  // Count how many times price bounced off each level
  for (const level of merged) {
    const tolerance = level.price * 0.015;
    let bounces = 0;
    for (let i = 1; i < data.length - 1; i++) {
      const touchedFromAbove = data[i].low <= level.price + tolerance && data[i].low >= level.price - tolerance && data[i + 1].close > level.price;
      const touchedFromBelow = data[i].high >= level.price - tolerance && data[i].high <= level.price + tolerance && data[i + 1].close < level.price;
      if (touchedFromAbove || touchedFromBelow) bounces++;
    }
    level.touches = Math.max(level.touches, bounces);
    if (level.touches >= 3) level.strength = "strong";
    else if (level.touches >= 2) level.strength = level.strength === "weak" ? "moderate" : level.strength;
  }

  // --- 4. K-line reversal pattern confirmation (boost strength) ---
  for (const level of merged) {
    const tolerance = level.price * 0.02;
    for (let i = 1; i < data.length; i++) {
      const near = Math.abs(data[i].low - level.price) < tolerance || Math.abs(data[i].high - level.price) < tolerance;
      if (!near) continue;

      const body = Math.abs(data[i].close - data[i].open);
      const range = data[i].high - data[i].low;
      if (range === 0) continue;
      const lowerShadow = Math.min(data[i].open, data[i].close) - data[i].low;
      const upperShadow = data[i].high - Math.max(data[i].open, data[i].close);

      // Pin bar at support (long lower shadow)
      if (level.type === "support" && lowerShadow > body * 2 && lowerShadow > range * 0.6) {
        level.strength = "strong";
      }
      // Pin bar at resistance (long upper shadow)
      if (level.type === "resistance" && upperShadow > body * 2 && upperShadow > range * 0.6) {
        level.strength = "strong";
      }
      // Bullish engulfing at support
      if (level.type === "support" && i > 0 && data[i].close > data[i].open
        && data[i - 1].close < data[i - 1].open
        && data[i].close > data[i - 1].open && data[i].open < data[i - 1].close) {
        level.strength = "strong";
      }
    }
  }

  // --- 5. Filter: remove levels too close to current price (within 0.5%) ---
  const filtered = merged.filter(l => Math.abs(l.price - latest) / latest > 0.005);

  return filtered.sort((a, b) => b.price - a.price);
}

/**
 * Generate trade plan based on support/resistance + ATR
 * With current price awareness filter
 */
export function calcTradePlan(data: OHLCV[], levels: PriceLevel[]): TradePlan | null {
  if (data.length < 14 || levels.length < 2) return null;

  const latest = data[data.length - 1].close;

  // ATR(14)
  let atrSum = 0;
  for (let i = data.length - 14; i < data.length; i++) {
    const tr = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - (data[i - 1]?.close || data[i].open)),
      Math.abs(data[i].low - (data[i - 1]?.close || data[i].open))
    );
    atrSum += tr;
  }
  const atr = atrSum / 14;

  // Nearest support below current price
  const supports = levels.filter(l => l.type === "support" && l.price < latest).sort((a, b) => b.price - a.price);
  // Resistance above current price (at least 1 ATR away to be meaningful)
  const resistances = levels.filter(l => l.type === "resistance" && l.price > latest + atr).sort((a, b) => a.price - b.price);

  // Stop loss: below nearest support, cushioned by 0.5 ATR
  const stopLoss = supports.length > 0
    ? supports[0].price - atr * 0.5
    : latest - atr * 2;

  // Targets: nearest resistances
  const target1 = resistances.length > 0
    ? resistances[0].price
    : latest + atr * 3;

  const target2 = resistances.length > 1
    ? resistances[1].price
    : latest + atr * 5;

  const risk = latest - stopLoss;
  const reward = target1 - latest;
  const riskReward = risk > 0 ? +(reward / risk).toFixed(1) : 0;

  // Sanity: stop loss shouldn't be more than 15% away
  const maxStop = latest * 0.85;
  const finalStop = Math.max(stopLoss, maxStop);

  return { entry: latest, stopLoss: finalStop, target1, target2, riskReward };
}
