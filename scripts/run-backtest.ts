#!/usr/bin/env tsx
// Walk-forward backtest CLI
// Usage: npx tsx scripts/run-backtest.ts --symbols TSLA,NVDA --start 2020-01-01 --end 2024-01-01

import { backtestSymbol, summarizeBacktest, BacktestConfig, BacktestPick } from "../src/lib/backtest-engine";
import type { OHLCV } from "../src/lib/indicators";

const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const symbols = getArg("symbols", "TSLA,NVDA,AAPL").split(",");
const startDate = getArg("start", "2020-01-01");
const endDate = getArg("end", "2024-01-01");
const holdingDays = parseInt(getArg("hold", "504")); // ~2 years

const config: BacktestConfig = {
  startDate,
  endDate,
  lookbackDays: 150,
  holdingDays,
};

async function fetchHistoricalData(symbol: string): Promise<OHLCV[]> {
  const mod = await import("yahoo-finance2");
  const YahooFinance = mod.default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

  // Fetch from well before startDate to have lookback data
  const fetchStart = new Date(startDate);
  fetchStart.setDate(fetchStart.getDate() - config.lookbackDays * 2);

  const result = await yf.chart(symbol, {
    period1: fetchStart.toISOString().split("T")[0],
    period2: endDate,
    interval: "1d",
  });

  return (result.quotes || [])
    .filter(q => q.open != null && q.high != null && q.low != null && q.close != null)
    .map(q => ({
      time: Math.floor(new Date(q.date).getTime() / 1000),
      open: q.open!,
      high: q.high!,
      low: q.low!,
      close: q.close!,
      volume: q.volume || 0,
    }));
}

async function main() {
  console.log(`\n🔬 Walk-Forward Backtest`);
  console.log(`   Symbols: ${symbols.join(", ")}`);
  console.log(`   Period:  ${startDate} → ${endDate}`);
  console.log(`   Hold:    ${holdingDays} trading days (~${Math.round(holdingDays / 252)} years)\n`);

  const allPicks: BacktestPick[] = [];

  for (const symbol of symbols) {
    process.stdout.write(`📊 ${symbol}: fetching data...`);
    try {
      const data = await fetchHistoricalData(symbol);
      process.stdout.write(` ${data.length} bars. Scanning...`);

      const picks = backtestSymbol(symbol, data, config);
      allPicks.push(...picks);

      console.log(` ${picks.length} consensus picks found.`);
      for (const p of picks) {
        const ret = p.returnPct !== undefined ? `${(p.returnPct * 100).toFixed(1)}%` : "pending";
        const dd = p.maxDrawdown !== undefined ? `DD:${(p.maxDrawdown * 100).toFixed(1)}%` : "";
        console.log(`   ${p.entryDate} @ $${p.entryPrice.toFixed(2)} → ${ret} ${dd} (score:${p.avgScore.toFixed(0)})`);
      }
    } catch (e) {
      console.log(` ❌ ${e instanceof Error ? e.message : e}`);
    }
  }

  // Summary
  const summary = summarizeBacktest(allPicks);
  console.log(`\n${"═".repeat(50)}`);
  console.log(`📈 BACKTEST SUMMARY`);
  console.log(`${"═".repeat(50)}`);
  console.log(`Total Picks:    ${summary.totalPicks}`);
  console.log(`Win Rate:       ${(summary.winRate * 100).toFixed(1)}% (${summary.wins}W / ${summary.losses}L)`);
  console.log(`Avg Return:     ${(summary.avgReturn * 100).toFixed(1)}%`);
  console.log(`Max Return:     ${(summary.maxReturn * 100).toFixed(1)}%`);
  console.log(`Max Drawdown:   ${(summary.maxDrawdown * 100).toFixed(1)}%`);
  console.log(`Avg Hold Days:  ${summary.avgHoldDays.toFixed(0)}`);
  console.log(`${"═".repeat(50)}\n`);

  // Save results to JSON
  const output = { config, symbols, picks: allPicks, summary };
  const fs = await import("fs");
  const outPath = `backtest-results-${startDate}-${endDate}.json`;
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`💾 Results saved to ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
