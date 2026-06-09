import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getIndicatorSummary, calcRiskScore, type OHLCV } from "@/lib/indicators";
import { calcSupportResistance, calcTradePlan } from "@/lib/levels";
import { runMultiAgentScoring } from "@/lib/multi-agent-scoring";

// POST /api/cron/run-analysis
// Fetches price data, computes indicators + multi-agent scores, caches results.

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

async function fetchChart(yahooSymbol: string): Promise<OHLCV[]> {
  // Use yahoo-finance2 with proper ESM import
  const mod = await import("yahoo-finance2");
  const YahooFinance = mod.default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const period1 = new Date(Date.now() - 150 * 86400000).toISOString().split("T")[0];
  const result = await yf.chart(yahooSymbol, { period1, interval: "1d" });
  const quotes = result.quotes || [];
  return quotes
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

async function notifyDiscord(results: { symbol: string; status: string; consensus?: boolean; avgScore?: number }[], date: string) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const consensusPicks = results.filter(r => r.consensus);
  const color = consensusPicks.length > 0 ? 0x00ff88 : 0x5865f2; // green if consensus, blue otherwise

  const fields = results.map(r => ({
    name: r.symbol,
    value: `${r.status}${r.avgScore ? ` (${r.avgScore.toFixed(0)}/100)` : ""}`,
    inline: true,
  }));

  const embed = {
    title: `📊 每日分析完成 — ${date}`,
    color,
    description: consensusPicks.length > 0
      ? `🟢 **共識標的**: ${consensusPicks.map(r => r.symbol).join(", ")}`
      : "⚪ 今日無全員共識標的",
    fields,
    footer: { text: "Stock Dashboard Cron | 5-Agent Scoring" },
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch { /* non-critical */ }
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const watchlist = (process.env.WATCHLIST || "NASDAQ:TSLA,NASDAQ:NVDA,NASDAQ:AAPL,TWSE:2330,TWSE:2454").split(",");
  const today = new Date().toISOString().split("T")[0];
  const cacheDir = path.join(process.cwd(), ".analysis-cache");
  await fs.mkdir(cacheDir, { recursive: true });

  const results: { symbol: string; status: string; consensus?: boolean; avgScore?: number }[] = [];

  for (const symbol of watchlist) {
    try {
      const raw = symbol.includes(":") ? symbol.split(":")[1] : symbol;
      const yahooSymbol = symbol.startsWith("TWSE:") ? `${raw}.TW` : raw;

      const periods = await fetchChart(yahooSymbol);
      if (periods.length < 20) { results.push({ symbol, status: "跳過：資料不足" }); continue; }

      const indicators = getIndicatorSummary(periods);
      const riskScore = calcRiskScore(periods);
      const levels = calcSupportResistance(periods);
      const tradePlan = calcTradePlan(periods, levels);
      const scoring = runMultiAgentScoring(symbol, periods);

      const last = periods[periods.length - 1];
      const analysis = buildAnalysis(symbol, last, indicators, riskScore, levels, tradePlan, scoring);

      const cacheFile = path.join(cacheDir, `${symbol.replace(/[:/]/g, "_")}_${today}.json`);
      await fs.writeFile(cacheFile, JSON.stringify({
        symbol, date: today, analysis, indicators, tradePlan, scoring, ts: Date.now(),
      }));
      results.push({ symbol, status: scoring.consensus ? "🟢 共識通過" : "⚪ 完成", consensus: scoring.consensus, avgScore: scoring.avgScore });
    } catch (e) {
      results.push({ symbol, status: `❌ ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  // Write run summary
  const summaryFile = path.join(cacheDir, `_last_run.json`);
  await fs.writeFile(summaryFile, JSON.stringify({ date: today, ts: Date.now(), results }));

  // Discord notification
  await notifyDiscord(results, today);

  return NextResponse.json({ date: today, results });
}

function buildAnalysis(
  symbol: string, last: OHLCV, indicators: ReturnType<typeof getIndicatorSummary>,
  riskScore: number, levels: ReturnType<typeof calcSupportResistance>,
  tradePlan: ReturnType<typeof calcTradePlan>, scoring: ReturnType<typeof runMultiAgentScoring>
): string {
  const supports = levels.filter(l => l.type === "support").slice(0, 3);
  const resistances = levels.filter(l => l.type === "resistance").slice(0, 3);
  const macdStatus = indicators.macd.dif > indicators.macd.dea ? "多頭" : "空頭";
  const rsiStatus = indicators.rsi.value > 70 ? "超買" : indicators.rsi.value < 30 ? "超賣" : "中性";

  return `## ${symbol} — ${scoring.recommendation}

### 多重代理人評分 (共識: ${scoring.consensus ? "✅" : "❌"}, 均分: ${scoring.avgScore.toFixed(0)}/100)
${scoring.agents.map(a => `| ${a.agent} | ${a.score}/100 ${a.signal} | ${a.reasoning} |`).join("\n")}

### 技術面
- 收盤價：${last.close.toFixed(2)}
- MACD：DIF=${indicators.macd.dif.toFixed(2)} DEA=${indicators.macd.dea.toFixed(2)} ${macdStatus}
- RSI(14)：${indicators.rsi.value.toFixed(1)} ${rsiStatus}
- KDJ：K=${indicators.kdj.k.toFixed(1)} D=${indicators.kdj.d.toFixed(1)} J=${indicators.kdj.j.toFixed(1)}
- 均線：${indicators.ma.status}

### 關鍵價位
支撐：${supports.map(l => l.price.toFixed(2)).join(" / ") || "N/A"}
壓力：${resistances.map(l => l.price.toFixed(2)).join(" / ") || "N/A"}

### 交易計劃
${tradePlan ? `進場=${tradePlan.entry.toFixed(2)} 停損=${tradePlan.stopLoss.toFixed(2)} T1=${tradePlan.target1.toFixed(2)} T2=${tradePlan.target2.toFixed(2)} R:R=1:${tradePlan.riskReward.toFixed(1)}` : "無"}

### 風險 ${riskScore}/10 ${riskScore >= 7 ? "🔴" : riskScore >= 4 ? "🟡" : "🟢"}`;
}
