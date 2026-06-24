#!/usr/bin/env tsx
// Batch backtest: tests scoring engine on known explosive stocks (SNDK-like patterns)
// Usage: npx tsx scripts/batch-backtest.ts [--hold 504] [--start 2020-01-01] [--end 2024-06-01]

import { backtestSymbol, summarizeBacktest, BacktestConfig, BacktestPick } from "../src/lib/backtest-engine";
import type { OHLCV } from "../src/lib/indicators";
import * as fs from "fs";

// SNDK-like stocks: mature company + structural shift + supply-demand imbalance + catalyst
const TARGETS = [
  { symbol: "NVDA", why: "AI structural shift, data center demand explosion (2023)" },
  { symbol: "TSLA", why: "EV adoption S-curve, manufacturing scale (2020)" },
  { symbol: "SMCI", why: "AI server demand, supply-constrained (2023)" },
  { symbol: "AMD", why: "Datacenter CPU/GPU share gain vs Intel (2020-2023)" },
  { symbol: "META", why: "Year of efficiency + Reels monetization (2023)" },
  { symbol: "ENPH", why: "Solar ITC + residential demand explosion (2020-2022)" },
  { symbol: "CELH", why: "Distribution deal + category disruption (2022-2023)" },
];

const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const startDate = getArg("start", "2020-01-01");
const endDate = getArg("end", "2024-06-01");
const holdingDays = parseInt(getArg("hold", "504"));

const config: BacktestConfig = { startDate, endDate, lookbackDays: 150, holdingDays };

async function fetchData(symbol: string): Promise<OHLCV[]> {
  const mod = await import("yahoo-finance2");
  const YahooFinance = mod.default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const fetchStart = new Date(startDate);
  fetchStart.setDate(fetchStart.getDate() - config.lookbackDays * 2);
  // Extend end to capture holding period outcomes
  const fetchEnd = new Date(endDate);
  fetchEnd.setDate(fetchEnd.getDate() + holdingDays * 1.5);

  const result = await yf.chart(symbol, {
    period1: fetchStart.toISOString().split("T")[0],
    period2: fetchEnd.toISOString().split("T")[0],
    interval: "1d",
  });
  return (result.quotes || [])
    .filter(q => q.open != null && q.close != null)
    .map(q => ({
      time: Math.floor(new Date(q.date).getTime() / 1000),
      open: q.open!, high: q.high!, low: q.low!, close: q.close!, volume: q.volume || 0,
    }));
}

async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`🔬 SNDK-Like Batch Backtest`);
  console.log(`   Period: ${startDate} → ${endDate} | Hold: ${holdingDays}d`);
  console.log(`   Targets: ${TARGETS.map(t => t.symbol).join(", ")}`);
  console.log(`${"═".repeat(60)}\n`);

  const allPicks: BacktestPick[] = [];
  const perSymbol: { symbol: string; why: string; picks: BacktestPick[]; bars: number }[] = [];

  for (const t of TARGETS) {
    process.stdout.write(`📊 ${t.symbol} (${t.why})...`);
    try {
      const data = await fetchData(t.symbol);
      const picks = backtestSymbol(t.symbol, data, config);
      allPicks.push(...picks);
      perSymbol.push({ ...t, picks, bars: data.length });
      console.log(` ${data.length} bars → ${picks.length} picks`);
      for (const p of picks) {
        const ret = p.returnPct != null ? `${(p.returnPct * 100).toFixed(1)}%` : "?";
        const dd = p.maxDrawdown != null ? `DD:${(p.maxDrawdown * 100).toFixed(1)}%` : "";
        console.log(`   ${p.entryDate} @ $${p.entryPrice.toFixed(2)} → ${ret} ${dd} (avg:${p.avgScore.toFixed(0)})`);
      }
    } catch (e) {
      console.log(` ❌ ${e instanceof Error ? e.message : e}`);
      perSymbol.push({ ...t, picks: [], bars: 0 });
    }
    // Rate limit yahoo
    await new Promise(r => setTimeout(r, 1000));
  }

  // Summary
  const summary = summarizeBacktest(allPicks);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`📈 AGGREGATE RESULTS`);
  console.log(`${"═".repeat(60)}`);
  console.log(`Total Picks:   ${summary.totalPicks}`);
  console.log(`Win Rate:      ${(summary.winRate * 100).toFixed(1)}% (${summary.wins}W / ${summary.losses}L)`);
  console.log(`Avg Return:    ${(summary.avgReturn * 100).toFixed(1)}%`);
  console.log(`Max Return:    ${(summary.maxReturn * 100).toFixed(1)}%`);
  console.log(`Max Drawdown:  ${(summary.maxDrawdown * 100).toFixed(1)}%`);
  console.log(`Avg Hold:      ${summary.avgHoldDays.toFixed(0)} days`);
  console.log(`${"═".repeat(60)}`);

  // Grade the system
  const grade = summary.winRate >= 0.7 && summary.avgReturn > 0.5 ? "A"
    : summary.winRate >= 0.5 && summary.avgReturn > 0.2 ? "B"
    : summary.winRate >= 0.4 ? "C" : "D";
  console.log(`\n🏆 System Grade: ${grade}`);
  console.log(`   (A=70%+ WR & 50%+ avg ret, B=50%+ WR & 20%+ ret, C=40%+ WR, D=below)\n`);

  // Per-symbol breakdown
  console.log(`\nPer-Symbol Breakdown:`);
  for (const s of perSymbol) {
    const sm = summarizeBacktest(s.picks);
    const status = s.picks.length === 0 ? "❌ No picks (too selective)"
      : sm.winRate >= 0.5 ? "✅" : "⚠️";
    console.log(`  ${status} ${s.symbol}: ${s.picks.length} picks, WR=${(sm.winRate*100).toFixed(0)}%, avg=${(sm.avgReturn*100).toFixed(0)}%`);
  }

  // Save report
  const report = { config, targets: TARGETS, perSymbol, allPicks, summary, grade, generatedAt: new Date().toISOString() };
  const outPath = `batch-backtest-report.json`;
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n💾 Full report: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
