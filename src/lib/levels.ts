import { OHLCV } from "./indicators";

export interface PriceLevel {
  price: number;
  type: "support" | "resistance";
  strength: "strong" | "moderate" | "weak";
  volume: number;
}

export interface TradePlan {
  stopLoss: number;
  target1: number;
  target2: number;
  riskReward: number;
  entry: number;
}

/**
 * Calculate support/resistance levels from volume profile + price action
 */
export function calcSupportResistance(data: OHLCV[]): PriceLevel[] {
  if (data.length < 20) return [];

  const latest = data[data.length - 1].close;
  const levels: PriceLevel[] = [];

  // Volume Profile: divide price range into bins, find high-volume nodes
  const prices = data.map(d => d.close);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const bins = 30;
  const binSize = (max - min) / bins;
  const volumeProfile: { price: number; volume: number }[] = [];

  for (let i = 0; i < bins; i++) {
    const binLow = min + i * binSize;
    const binHigh = binLow + binSize;
    const binMid = (binLow + binHigh) / 2;
    let vol = 0;
    for (const d of data) {
      if (d.close >= binLow && d.close < binHigh) vol += d.volume;
    }
    volumeProfile.push({ price: binMid, volume: vol });
  }

  // Find high-volume nodes (top 30%)
  const sortedVols = [...volumeProfile].sort((a, b) => b.volume - a.volume);
  const threshold = sortedVols[Math.floor(bins * 0.3)]?.volume || 0;

  for (const node of volumeProfile) {
    if (node.volume >= threshold) {
      const type = node.price < latest ? "support" : "resistance";
      const strength = node.volume >= sortedVols[2]?.volume ? "strong"
        : node.volume >= sortedVols[5]?.volume ? "moderate" : "weak";
      levels.push({ price: node.price, type, volume: node.volume, strength });
    }
  }

  // Add recent swing highs/lows
  for (let i = 5; i < data.length - 5; i++) {
    const isSwingHigh = data[i].high > data[i-1].high && data[i].high > data[i-2].high
      && data[i].high > data[i+1].high && data[i].high > data[i+2].high;
    const isSwingLow = data[i].low < data[i-1].low && data[i].low < data[i-2].low
      && data[i].low < data[i+1].low && data[i].low < data[i+2].low;

    if (isSwingHigh && data[i].high > latest) {
      levels.push({ price: data[i].high, type: "resistance", strength: "moderate", volume: data[i].volume });
    }
    if (isSwingLow && data[i].low < latest) {
      levels.push({ price: data[i].low, type: "support", strength: "moderate", volume: data[i].volume });
    }
  }

  // Deduplicate nearby levels (within 1%)
  const merged: PriceLevel[] = [];
  const sorted = levels.sort((a, b) => a.price - b.price);
  for (const level of sorted) {
    const existing = merged.find(m => Math.abs(m.price - level.price) / level.price < 0.01);
    if (existing) {
      if (level.volume > existing.volume) {
        existing.price = level.price;
        existing.volume = level.volume;
        existing.strength = level.strength;
      }
    } else {
      merged.push({ ...level });
    }
  }

  return merged.sort((a, b) => b.price - a.price);
}

/**
 * Generate trade plan based on support/resistance + ATR
 */
export function calcTradePlan(data: OHLCV[], levels: PriceLevel[]): TradePlan | null {
  if (data.length < 14 || levels.length < 2) return null;

  const latest = data[data.length - 1].close;

  // ATR(14)
  let atrSum = 0;
  for (let i = data.length - 14; i < data.length; i++) {
    const tr = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i-1]?.close || 0),
      Math.abs(data[i].low - data[i-1]?.close || 0)
    );
    atrSum += tr;
  }
  const atr = atrSum / 14;

  // Nearest support below = stop loss area
  const supports = levels.filter(l => l.type === "support" && l.price < latest).sort((a, b) => b.price - a.price);
  // Only use resistance levels that are meaningful (at least 1.5x ATR away)
  const resistances = levels.filter(l => l.type === "resistance" && l.price > latest + atr * 1.5).sort((a, b) => a.price - b.price);

  const stopLoss = supports.length > 0
    ? supports[0].price - atr * 0.5
    : latest - atr * 2;

  const target1 = resistances.length > 0
    ? resistances[0].price
    : latest + atr * 2.5;

  const target2 = resistances.length > 1
    ? resistances[1].price
    : latest + atr * 4;

  const risk = latest - stopLoss;
  const reward = target1 - latest;
  const riskReward = risk > 0 ? reward / risk : 0;

  return { entry: latest, stopLoss, target1, target2, riskReward };
}
