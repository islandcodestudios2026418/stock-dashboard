#!/usr/bin/env tsx
// Diagnostic: show agent scores on specific dates to debug consensus threshold
import { OHLCV } from "../src/lib/indicators";
import { runMultiAgentScoring } from "../src/lib/multi-agent-scoring";

const symbol = process.argv[2] || "NVDA";
const startDate = process.argv[3] || "2023-01-01";
const endDate = process.argv[4] || "2024-06-01";

async function main() {
  const mod = await import("yahoo-finance2");
  const YahooFinance = mod.default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

  const fetchStart = new Date(startDate);
  fetchStart.setDate(fetchStart.getDate() - 300);

  const result = await yf.chart(symbol, {
    period1: fetchStart.toISOString().split("T")[0],
    period2: endDate,
    interval: "1d",
  });

  const allData: OHLCV[] = (result.quotes || [])
    .filter(q => q.open != null && q.close != null)
    .map(q => ({
      time: Math.floor(new Date(q.date).getTime() / 1000),
      open: q.open!, high: q.high!, low: q.low!, close: q.close!, volume: q.volume || 0,
    }));

  console.log(`\n📊 ${symbol} Score Debug (${allData.length} bars total)\n`);

  // Sample every 20 trading days in the scoring window
  const startTs = new Date(startDate).getTime() / 1000;
  const endTs = new Date(endDate).getTime() / 1000;
  let bestScore = 0;
  let bestDate = "";

  for (let i = 150; i < allData.length; i += 10) {
    const day = allData[i];
    if (day.time < startTs || day.time > endTs) continue;

    const window = allData.slice(Math.max(0, i - 150), i + 1);
    const r = runMultiAgentScoring(symbol, window);
    const date = new Date(day.time * 1000).toISOString().split("T")[0];

    if (r.avgScore > bestScore) { bestScore = r.avgScore; bestDate = date; }

    // Print dates where avg >= 55 (close to consensus)
    if (r.avgScore >= 55) {
      const scores = r.agents.map(a => `${a.agent.split("(")[0]}=${a.score}`).join(" ");
      console.log(`${date} $${day.close.toFixed(2)} avg=${r.avgScore.toFixed(0)} | ${scores}`);
    }
  }

  console.log(`\n🏆 Best: ${bestDate} avg=${bestScore.toFixed(0)}`);
  
  // Show detailed breakdown for best date
  const bestIdx = allData.findIndex(d => new Date(d.time * 1000).toISOString().split("T")[0] === bestDate);
  if (bestIdx > 0) {
    const window = allData.slice(Math.max(0, bestIdx - 150), bestIdx + 1);
    const r = runMultiAgentScoring(symbol, window);
    console.log(`\n--- Best Date Detail ---`);
    for (const a of r.agents) {
      console.log(`  ${a.agent}: ${a.score}/100 ${a.signal} — ${a.reasoning}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
