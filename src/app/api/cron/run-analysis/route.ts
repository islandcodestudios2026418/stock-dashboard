import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// POST /api/cron/run-analysis
// Triggered by external scheduler (Zeabur cron, Vercel cron, or manual).
// Fetches price data for each watchlist stock, computes indicators, and
// saves results to .analysis-cache for instant frontend loading.

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const watchlist = (process.env.WATCHLIST || "NASDAQ:TSLA,NASDAQ:NVDA,NASDAQ:AAPL,TWSE:2330,TWSE:2454").split(",");
  const today = new Date().toISOString().split("T")[0];
  const cacheDir = path.join(process.cwd(), ".analysis-cache");
  await fs.mkdir(cacheDir, { recursive: true });

  const { default: YahooFinance } = await import("yahoo-finance2");
  const { getIndicatorSummary, calcRiskScore } = await import("@/lib/indicators");
  const { calcSupportResistance, calcTradePlan } = await import("@/lib/levels");

  const results: { symbol: string; status: string }[] = [];

  for (const symbol of watchlist) {
    try {
      const raw = symbol.includes(":") ? symbol.split(":")[1] : symbol;
      const yahooSymbol = symbol.startsWith("TWSE:") ? `${raw}.TW` : raw;

      const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"], validation: { logErrors: false } });
      const chartData: any = await yf.chart(yahooSymbol, { period1: new Date(Date.now() - 120 * 86400000).toISOString().split("T")[0], interval: "1d" });
      const quotes = chartData.quotes || [];
      if (quotes.length < 20) { results.push({ symbol, status: "跳過：資料不足" }); continue; }

      const periods = quotes.map((q: any) => ({
        time: Math.floor(new Date(q.date).getTime() / 1000),
        open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume || 0,
      }));

      const indicators = getIndicatorSummary(periods);
      const riskScore = calcRiskScore(periods);
      const levels = calcSupportResistance(periods);
      const tradePlan = calcTradePlan(periods, levels);
      const last = periods[periods.length - 1];

      // Build a summary analysis (rule-based, no LLM needed for cron)
      const analysis = buildRuleAnalysis(symbol, last, indicators, riskScore, levels, tradePlan);

      const cacheFile = path.join(cacheDir, `${symbol.replace(/[:/]/g, "_")}_${today}.json`);
      await fs.writeFile(cacheFile, JSON.stringify({ symbol, date: today, analysis, indicators, tradePlan, ts: Date.now() }));
      results.push({ symbol, status: "✅ 完成" });
    } catch (e) {
      results.push({ symbol, status: `❌ ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  return NextResponse.json({ date: today, results });
}

function buildRuleAnalysis(
  symbol: string, last: any, indicators: any, riskScore: number, levels: any[], tradePlan: any
): string {
  const supports = levels.filter((l: any) => l.type === "support").slice(0, 3);
  const resistances = levels.filter((l: any) => l.type === "resistance").slice(0, 3);

  const macdStatus = indicators.macd.dif > indicators.macd.dea ? "多頭" : "空頭";
  const rsiStatus = indicators.rsi.value > 70 ? "超買" : indicators.rsi.value < 30 ? "超賣" : "中性";

  return `## 行情說明
### 收盤價：${last.close.toFixed(2)}
- MACD：DIF=${indicators.macd.dif.toFixed(2)}，DEA=${indicators.macd.dea.toFixed(2)}，${macdStatus}
- RSI(14)：${indicators.rsi.value.toFixed(1)}，${rsiStatus}
- KDJ：K=${indicators.kdj.k.toFixed(1)} D=${indicators.kdj.d.toFixed(1)} J=${indicators.kdj.j.toFixed(1)}
- 均線排列：${indicators.ma.status}

## 關鍵價位
### 支撐位
${supports.map((l: any) => `- ${l.price.toFixed(2)}（強度：${l.strength}，觸碰${l.touches}次）`).join("\n")}
### 壓力位
${resistances.map((l: any) => `- ${l.price.toFixed(2)}（強度：${l.strength}，觸碰${l.touches}次）`).join("\n")}

## 交易策略建議
${tradePlan ? `- 進場：${tradePlan.entry.toFixed(2)}
- 停損：${tradePlan.stopLoss.toFixed(2)}
- 目標1：${tradePlan.target1.toFixed(2)}
- 目標2：${tradePlan.target2.toFixed(2)}
- 風險報酬比：1:${tradePlan.riskReward.toFixed(1)}` : "資料不足，無法生成交易計劃"}

## 風險評估
風險分數：${riskScore}/10 ${riskScore >= 7 ? "🔴 高風險" : riskScore >= 4 ? "🟡 中等風險" : "🟢 低風險"}`;
}
