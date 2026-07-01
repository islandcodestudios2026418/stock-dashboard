/**
 * validate-sndk-patterns.ts — Backtest supply-demand detector on known winners
 *
 * Tests: would our detector have identified these stocks BEFORE their explosive moves?
 * - NVDA: pre-2023 AI explosion (picked up at $15-30, went to $140+)
 * - META: pre-2023 Year of Efficiency (picked up at $90-120, went to $500+)
 * - SMCI: pre-2023 AI server boom (picked up at $60-80, went to $1000+)
 * - AMD: pre-2023 AI catch-up rally ($55-70, went to $180+)
 *
 * Method: Walk-forward, testing every day from startDate to endDate.
 * At each day, run supply-demand analysis using ONLY data up to that point.
 * Record when detector fires (score >= 50) and check subsequent 1-year return.
 *
 * Usage: npx tsx scripts/validate-sndk-patterns.ts
 */

import YahooFinance from "yahoo-finance2";

interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SDResult {
  score: number;
  components: { supply: number; demand: number; consolidation: number; pricing: number };
  phase: string;
  triggers: string[];
}

// ======= SUPPLY-DEMAND DETECTOR (inline copy for standalone script) =======

function calcEMA(data: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  let ema = data[0];
  for (let i = 0; i < data.length; i++) {
    if (i === 0) { result.push(data[0]); continue; }
    ema = data[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

function analyzeSupplyDemandSlice(stockData: OHLCV[], sectorData: OHLCV[] | null): SDResult {
  const n = stockData.length;
  if (n < 120) return { score: 0, components: { supply: 0, demand: 0, consolidation: 0, pricing: 0 }, phase: "NO_DATA", triggers: [] };

  const closes = stockData.map(d => d.close);
  const volumes = stockData.map(d => d.volume);
  const triggers: string[] = [];

  // === SUPPLY (0-25) ===
  let supplyScore = 0;
  const vol30d = volumes.slice(-30).reduce((a, b) => a + b, 0) / 30;
  const vol90d = volumes.slice(-90, -30).reduce((a, b) => a + b, 0) / 60;
  const volDecline = vol90d > 0 ? (vol30d - vol90d) / vol90d : 0;
  if (volDecline < -0.3 && closes[n - 1] >= closes[n - 60]) {
    supplyScore += 10;
    triggers.push(`vol declined ${(volDecline * 100).toFixed(0)}%`);
  }

  // ATR compression
  const atr14: number[] = [];
  for (let i = 14; i < n; i++) {
    let sum = 0;
    for (let j = i - 14; j < i; j++) {
      const tr = Math.max(stockData[j + 1].high - stockData[j + 1].low, Math.abs(stockData[j + 1].high - stockData[j].close), Math.abs(stockData[j + 1].low - stockData[j].close));
      sum += tr;
    }
    atr14.push(sum / 14);
  }
  const curATRPct = atr14.length > 0 ? (atr14[atr14.length - 1] / closes[n - 1]) * 100 : 5;
  const avgATRPct = atr14.length > 30 ? (atr14.slice(-60, -20).reduce((a, b) => a + b, 0) / 40 / closes[n - 30]) * 100 : curATRPct;
  if (curATRPct < avgATRPct * 0.6) { supplyScore += 8; triggers.push("ATR compressed"); }

  // Base building
  const last60 = closes.slice(-60);
  const range60 = (Math.max(...last60) - Math.min(...last60)) / closes[n - 1];
  if (range60 < 0.15) { supplyScore += 7; triggers.push("tight base"); }
  supplyScore = Math.min(25, supplyScore);

  // === DEMAND (0-25) ===
  let demandScore = 0;
  let upDayVol = 0, downDayVol = 0, upDays = 0, downDays = 0;
  for (let i = n - 20; i < n; i++) {
    if (stockData[i].close > stockData[i - 1].close) { upDayVol += volumes[i]; upDays++; }
    else { downDayVol += volumes[i]; downDays++; }
  }
  const avgUpVol = upDays > 0 ? upDayVol / upDays : 0;
  const avgDownVol = downDays > 0 ? downDayVol / downDays : 1;
  const upDownRatio = avgUpVol / avgDownVol;
  if (upDownRatio > 2.0) { demandScore += 10; triggers.push(`up/down vol ${upDownRatio.toFixed(1)}x`); }
  else if (upDownRatio > 1.5) { demandScore += 5; }

  const ret20d = (closes[n - 1] - closes[n - 20]) / closes[n - 20];
  const ret60d = (closes[n - 1] - closes[n - 60]) / closes[n - 60];
  if (ret20d / 20 > ret60d / 60 * 2 && ret20d > 0.05) { demandScore += 8; triggers.push("accelerating"); }

  const high60d = Math.max(...closes.slice(-60, -5));
  if (closes[n - 1] > high60d * 1.02 && vol30d > vol90d * 1.3) { demandScore += 7; triggers.push("breakout"); }
  demandScore = Math.min(25, demandScore);

  // === CONSOLIDATION (0-25) ===
  let consolidationScore = 0;
  if (sectorData && sectorData.length >= 120) {
    const sectorCloses = sectorData.map(d => d.close);
    const sn = sectorCloses.length;
    const minLen = Math.min(n, sn);
    const stockRet60 = (closes[n - 1] - closes[n - Math.min(60, minLen)]) / closes[n - Math.min(60, minLen)];
    const sectorRet60 = (sectorCloses[sn - 1] - sectorCloses[sn - Math.min(60, minLen)]) / sectorCloses[sn - Math.min(60, minLen)];
    const outperf = stockRet60 - sectorRet60;
    if (outperf > 0.15) { consolidationScore += 12; triggers.push(`outperf sector ${(outperf * 100).toFixed(0)}%`); }
    else if (outperf > 0.08) { consolidationScore += 6; }

    const stockAtHigh = closes[n - 1] >= Math.max(...closes.slice(-120)) * 0.95;
    const sectorBelow = sectorCloses[sn - 1] < Math.max(...sectorCloses.slice(-120)) * 0.9;
    if (stockAtHigh && sectorBelow) { consolidationScore += 10; triggers.push("stock highs, sector lags"); }
  } else {
    let newHighCount = 0;
    for (let i = n - 60; i < n; i++) {
      if (closes[i] >= Math.max(...closes.slice(0, i))) newHighCount++;
    }
    if (newHighCount >= 10) { consolidationScore += 8; triggers.push(`${newHighCount} new highs`); }
  }
  consolidationScore = Math.min(25, consolidationScore);

  // === PRICING POWER (0-25) ===
  let pricingScore = 0;
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const emaSpread = (ema21[n - 1] - ema50[n - 1]) / ema50[n - 1];
  const emaSpread30d = n > 30 ? (ema21[n - 30] - ema50[n - 30]) / ema50[n - 30] : emaSpread;
  if (emaSpread > emaSpread30d && emaSpread > 0.03) { pricingScore += 8; triggers.push("EMA spread widening"); }

  if (closes[n - 1] > closes[n - 30] && vol30d < vol90d * 0.8) { pricingScore += 8; triggers.push("effortless advance"); }

  let strongGreen = 0;
  for (let i = n - 20; i < n; i++) {
    const body = stockData[i].close - stockData[i].open;
    const range = stockData[i].high - stockData[i].low;
    if (body > 0 && range > 0 && body / range > 0.6 && body / stockData[i].close > 0.01) strongGreen++;
  }
  if (strongGreen >= 8) { pricingScore += 9; triggers.push(`${strongGreen} strong candles`); }
  else if (strongGreen >= 5) { pricingScore += 4; }
  pricingScore = Math.min(25, pricingScore);

  const score = supplyScore + demandScore + consolidationScore + pricingScore;
  let phase = "NO_PATTERN";
  if (score >= 60 && demandScore >= 15 && supplyScore >= 10) phase = "MARKUP_BEGINS";
  else if (demandScore >= 15) phase = "DEMAND_INFLECTION";
  else if (supplyScore >= 15) phase = "SUPPLY_TIGHTENING";
  else if (supplyScore >= 8 && consolidationScore >= 8) phase = "EARLY_ACCUMULATION";

  return { score, components: { supply: supplyScore, demand: demandScore, consolidation: consolidationScore, pricing: pricingScore }, phase, triggers };
}

// ======= BACKTEST RUNNER =======

interface BacktestPick {
  date: string;
  price: number;
  score: number;
  phase: string;
  triggers: string[];
  return1yr: number | null;
  maxReturn: number | null;
  maxDrawdown: number | null;
}

async function fetchFullHistory(symbol: string, startDate: string): Promise<OHLCV[]> {
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const result = await yf.chart(symbol, { period1: startDate, interval: "1d" });
  return (result.quotes || []).filter(q => q.close != null).map(q => ({
    time: Math.floor(new Date(q.date).getTime() / 1000),
    open: q.open!, high: q.high!, low: q.low!, close: q.close!, volume: q.volume || 0,
  }));
}

async function backtestSymbol(symbol: string, sectorSymbol: string, scanStart: string, scanEnd: string): Promise<{ symbol: string; picks: BacktestPick[]; summary: string }> {
  console.log(`\n📊 Backtesting ${symbol} (sector: ${sectorSymbol}) from ${scanStart} to ${scanEnd}...`);

  // Fetch full history (need extra 250 days before scanStart for lookback)
  const historyStart = new Date(new Date(scanStart).getTime() - 300 * 86400000).toISOString().split("T")[0];
  const [stockData, sectorData] = await Promise.all([
    fetchFullHistory(symbol, historyStart),
    fetchFullHistory(sectorSymbol, historyStart),
  ]);

  console.log(`  Loaded ${stockData.length} days stock, ${sectorData.length} days sector`);

  const scanStartTs = new Date(scanStart).getTime() / 1000;
  const scanEndTs = new Date(scanEnd).getTime() / 1000;
  const picks: BacktestPick[] = [];
  let lastPickDay = 0; // 30-day cooldown between picks

  // Walk forward: for each day in scan range, analyze using only past data
  for (let i = 150; i < stockData.length; i++) {
    const today = stockData[i];
    if (today.time < scanStartTs || today.time > scanEndTs) continue;
    if (i - lastPickDay < 30) continue; // cooldown

    // Slice data up to today (NO look-ahead)
    const stockSlice = stockData.slice(0, i + 1);
    const sectorSlice = sectorData.filter(d => d.time <= today.time);

    const result = analyzeSupplyDemandSlice(stockSlice, sectorSlice.length >= 120 ? sectorSlice : null);

    if (result.score >= 50) {
      lastPickDay = i;
      const date = new Date(today.time * 1000).toISOString().split("T")[0];

      // Calculate 1-year forward return (252 trading days)
      const futureData = stockData.slice(i + 1, i + 253);
      let return1yr: number | null = null;
      let maxReturn: number | null = null;
      let maxDrawdown: number | null = null;

      if (futureData.length > 0) {
        const entryPrice = today.close;
        let peak = entryPrice;
        let maxDD = 0;
        let maxRet = 0;

        for (const fd of futureData) {
          const ret = (fd.close - entryPrice) / entryPrice;
          if (ret > maxRet) maxRet = ret;
          if (fd.close > peak) peak = fd.close;
          const dd = (fd.close - peak) / peak;
          if (dd < maxDD) maxDD = dd;
        }

        const lastFuture = futureData[futureData.length - 1];
        return1yr = +((lastFuture.close - entryPrice) / entryPrice * 100).toFixed(1);
        maxReturn = +(maxRet * 100).toFixed(1);
        maxDrawdown = +(maxDD * 100).toFixed(1);
      }

      picks.push({ date, price: today.close, score: result.score, phase: result.phase, triggers: result.triggers, return1yr, maxReturn, maxDrawdown });
      console.log(`  ✅ PICK: ${date} @ $${today.close.toFixed(2)} — score ${result.score}, ${result.phase} → ${return1yr !== null ? `${return1yr}% (max: +${maxReturn}%)` : "pending"}`);
    }
  }

  const wins = picks.filter(p => p.return1yr !== null && p.return1yr > 0);
  const avgReturn = picks.filter(p => p.return1yr !== null).reduce((s, p) => s + (p.return1yr || 0), 0) / (picks.filter(p => p.return1yr !== null).length || 1);
  const summary = `${symbol}: ${picks.length} picks, WR ${picks.length > 0 ? ((wins.length / picks.filter(p => p.return1yr !== null).length) * 100).toFixed(0) : 0}%, avg return ${avgReturn.toFixed(1)}%`;

  return { symbol, picks, summary };
}

// ======= MAIN =======

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  SNDK Pattern Validation Backtest");
  console.log("  Testing supply-demand detector on known explosive winners");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const testCases = [
    { symbol: "NVDA", sector: "SMH", scanStart: "2022-01-01", scanEnd: "2023-06-01", expectedEvent: "AI explosion (ChatGPT Nov 2022 → NVDA earnings May 2023)" },
    { symbol: "META", sector: "XLK", scanStart: "2022-06-01", scanEnd: "2023-04-01", expectedEvent: "Year of Efficiency (layoffs Oct 2022 → Q4 earnings Feb 2023)" },
    { symbol: "SMCI", sector: "SMH", scanStart: "2022-06-01", scanEnd: "2023-06-01", expectedEvent: "AI server demand surge (ChatGPT → datacenter buildout)" },
    { symbol: "AMD", sector: "SMH", scanStart: "2022-06-01", scanEnd: "2023-06-01", expectedEvent: "AI catch-up (MI300 launch, datacenter GPU demand)" },
    { symbol: "CELH", sector: "XLP", scanStart: "2021-06-01", scanEnd: "2022-06-01", expectedEvent: "Distribution deal (Pepsi partnership Aug 2022)" },
    { symbol: "TSLA", sector: "CARZ", scanStart: "2019-06-01", scanEnd: "2020-06-01", expectedEvent: "Production ramp (Shanghai factory → profitability)" },
  ];

  const allResults: { symbol: string; picks: BacktestPick[]; summary: string }[] = [];

  for (const tc of testCases) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Expected: ${tc.expectedEvent}`);
    try {
      const result = await backtestSymbol(tc.symbol, tc.sector, tc.scanStart, tc.scanEnd);
      allResults.push(result);
    } catch (e) {
      console.error(`  ❌ FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Print aggregate results
  console.log("\n\n═══════════════════════════════════════════════════════════════");
  console.log("  AGGREGATE RESULTS");
  console.log("═══════════════════════════════════════════════════════════════\n");

  let totalPicks = 0, totalWins = 0, totalReturn = 0, counted = 0;
  for (const r of allResults) {
    console.log(`  ${r.summary}`);
    for (const p of r.picks) {
      if (p.return1yr !== null) {
        totalPicks++;
        if (p.return1yr > 0) totalWins++;
        totalReturn += p.return1yr;
        counted++;
      }
    }
  }

  console.log(`\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Total picks: ${totalPicks}`);
  console.log(`  Win rate: ${counted > 0 ? ((totalWins / counted) * 100).toFixed(1) : 0}%`);
  console.log(`  Avg return: ${counted > 0 ? (totalReturn / counted).toFixed(1) : 0}%`);
  console.log(`  Best: ${allResults.flatMap(r => r.picks).filter(p => p.maxReturn !== null).sort((a, b) => (b.maxReturn || 0) - (a.maxReturn || 0))[0]?.maxReturn || 0}%`);

  // Grade
  const winRate = counted > 0 ? totalWins / counted : 0;
  const avgRet = counted > 0 ? totalReturn / counted : 0;
  const grade = winRate >= 0.7 && avgRet >= 50 ? "A" : winRate >= 0.5 && avgRet >= 20 ? "B" : winRate >= 0.4 ? "C" : "D";
  console.log(`\n  🏆 GRADE: ${grade}`);
  console.log(`  (A=70%+ WR & 50%+ avg, B=50%+ WR & 20%+ avg, C=40%+ WR, D=below)`);

  // Save results
  const outputPath = `sndk-validation-${new Date().toISOString().split("T")[0]}.json`;
  const fs = await import("fs");
  fs.writeFileSync(outputPath, JSON.stringify({ grade, totalPicks, winRate: +(winRate * 100).toFixed(1), avgReturn: +avgRet.toFixed(1), results: allResults }, null, 2));
  console.log(`\n  📄 Results saved to ${outputPath}`);
}

main().catch(console.error);
