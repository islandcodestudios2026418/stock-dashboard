import { NextRequest, NextResponse } from "next/server";
import { OHLCV, getIndicatorSummary, calcRiskScore, calcBOLL, calcMACD, calcRSI } from "@/lib/indicators";
import { calcSupportResistance, calcTradePlan } from "@/lib/levels";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

export async function POST(req: NextRequest) {
  const { symbol, name, periods, lang = "zh-TW" } = await req.json() as {
    symbol: string; name: string; periods: OHLCV[]; lang?: string;
  };

  if (!periods || periods.length < 20) {
    return NextResponse.json({ error: "Not enough data" }, { status: 400 });
  }

  // Calculate all indicators
  const closes = periods.map((p: OHLCV) => p.close);
  const last = periods[periods.length - 1];
  const prev = periods[periods.length - 2];
  const indicators = getIndicatorSummary(periods);
  const riskScore = calcRiskScore(periods);
  const levels = calcSupportResistance(periods);
  const tradePlan = calcTradePlan(periods, levels);
  const boll = calcBOLL(closes);
  const macd = calcMACD(closes);
  const rsi = calcRSI(closes);

  const change = last.close - prev.close;
  const changePct = ((change / prev.close) * 100).toFixed(2);

  const supports = levels.filter(l => l.type === "support").slice(0, 3);
  const resistances = levels.filter(l => l.type === "resistance").slice(0, 3);

  const dataContext = `
Stock: ${name} (${symbol})
Current Price: ${last.close.toFixed(2)} (${change >= 0 ? "+" : ""}${changePct}%)
Open: ${last.open.toFixed(2)}, High: ${last.high.toFixed(2)}, Low: ${last.low.toFixed(2)}
Volume: ${last.volume.toLocaleString()} (20-day avg: ${indicators.volume.avg20.toLocaleString()})

BOLL(20): Upper=${boll.upper[boll.upper.length-1]?.toFixed(2)}, Mid=${boll.mid[boll.mid.length-1]?.toFixed(2)}, Lower=${boll.lower[boll.lower.length-1]?.toFixed(2)}
MACD: DIF=${macd.dif[macd.dif.length-1].toFixed(3)}, DEA=${macd.dea[macd.dea.length-1].toFixed(3)}, ${indicators.macd.status}
RSI(14): ${(rsi[rsi.length-1] ?? 50).toFixed(1)} (${indicators.rsi.status})
KDJ: K=${indicators.kdj.k.toFixed(1)}, D=${indicators.kdj.d.toFixed(1)}, J=${indicators.kdj.j.toFixed(1)} (${indicators.kdj.status})
MA Trend: ${indicators.ma.status}, SMA20=${indicators.ma.sma20?.toFixed(2)}
Volume Status: ${indicators.volume.status}

Support Levels: ${supports.map(s => `${s.price.toFixed(2)} (${s.strength})`).join(", ") || "N/A"}
Resistance Levels: ${resistances.map(r => `${r.price.toFixed(2)} (${r.strength})`).join(", ") || "N/A"}

Risk Score: ${riskScore}/10
${tradePlan ? `Trade Plan: Entry=${tradePlan.entry.toFixed(2)}, Stop=${tradePlan.stopLoss.toFixed(2)}, T1=${tradePlan.target1.toFixed(2)}, T2=${tradePlan.target2.toFixed(2)}, R:R=${tradePlan.riskReward.toFixed(2)}` : ""}

Recent 5 candles (newest first):
${periods.slice(-5).reverse().map(p => `  ${new Date(p.time * 1000).toLocaleDateString()}: O=${p.open.toFixed(2)} H=${p.high.toFixed(2)} L=${p.low.toFixed(2)} C=${p.close.toFixed(2)} V=${p.volume.toLocaleString()}`).join("\n")}
`;

  const prompt = lang === "zh-TW" ? `你是一位專業的股票技術分析師。根據以下數據，用繁體中文提供完整的技術面分析報告。

${dataContext}

請提供以下分析（用 Markdown 格式）：

## 大趨勢判斷
（目前處於什麼階段？主升浪、回調、盤整？）

## 今日盤勢性質
（今天的K線代表什麼？是洗盤、突破、還是趨勢延續？）

## 短線結構
（1-3天的走勢預判）

## 關鍵支撐與壓力
（根據成交量分佈和走勢，列出具體價位）

## 交易策略建議
### 已持倉
（該怎麼做？停損設哪？）
### 想進場
（在哪裡進？停損和目標？風險報酬比？）

## 主力意圖分析
（從量價關係判斷主力在做什麼）

## 風險因素
（列出目前的風險點）

## 未來劇本
（給出2-3個可能的走勢劇本和機率）

注意：分析要具體、有數字、有邏輯，不要空泛。` :

`You are a professional stock technical analyst. Based on the following data, provide a comprehensive technical analysis report.

${dataContext}

Provide the following analysis (in Markdown format):

## Overall Trend
(What phase is the stock in? Uptrend, pullback, consolidation?)

## Today's Price Action
(What does today's candle represent? Shakeout, breakout, trend continuation?)

## Short-term Structure
(1-3 day outlook)

## Key Support & Resistance
(Specific price levels based on volume profile and price action)

## Trading Strategy
### Already Holding
(What to do? Where to set stop-loss?)
### Want to Enter
(Where to enter? Stop-loss and targets? Risk-reward ratio?)

## Institutional Flow Analysis
(What are the big players doing based on volume-price relationship?)

## Risk Factors
(List current risks)

## Future Scenarios
(2-3 possible scenarios with probability estimates)

Be specific with numbers and logic, not vague.`;

  // If no API key, generate a structured analysis from the data directly
  if (!ANTHROPIC_KEY) {
    const fallback = generateFallbackAnalysis(periods, indicators, riskScore, levels, tradePlan, lang);
    return NextResponse.json({ analysis: fallback, levels, tradePlan, riskScore });
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const json = await res.json();
    const analysis = json.content?.[0]?.text || "Analysis generation failed";
    return NextResponse.json({ analysis, levels, tradePlan, riskScore });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "AI error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function generateFallbackAnalysis(
  periods: OHLCV[],
  indicators: ReturnType<typeof getIndicatorSummary>,
  riskScore: number,
  levels: ReturnType<typeof calcSupportResistance>,
  tradePlan: ReturnType<typeof calcTradePlan>,
  lang: string
) {
  const last = periods[periods.length - 1];
  const prev = periods[periods.length - 2];
  const change = last.close - prev.close;
  const isUp = change >= 0;
  const supports = levels.filter(l => l.type === "support").slice(0, 3);
  const resistances = levels.filter(l => l.type === "resistance").slice(0, 3);

  if (lang === "zh-TW") {
    return `## 大趨勢判斷
均線趨勢：**${indicators.ma.status === "bullish" ? "多頭排列" : "空頭排列"}**
MACD：${indicators.macd.status === "bullish" ? "多頭" : indicators.macd.status === "bearish" ? "空頭" : "中性"}（DIF: ${indicators.macd.dif.toFixed(3)}）

## 今日盤勢
${isUp ? "收紅" : "收黑"}，漲跌幅 ${((change / prev.close) * 100).toFixed(2)}%
成交量${indicators.volume.status === "bullish" ? "放大" : indicators.volume.status === "bearish" ? "萎縮" : "持平"}

## 關鍵支撐與壓力
**壓力位：** ${resistances.map(r => r.price.toFixed(2)).join(" → ") || "無明顯壓力"}
**支撐位：** ${supports.map(s => s.price.toFixed(2)).join(" → ") || "無明顯支撐"}

## 交易策略
${tradePlan ? `- 進場：${tradePlan.entry.toFixed(2)}
- 停損：${tradePlan.stopLoss.toFixed(2)}
- 目標1：${tradePlan.target1.toFixed(2)}
- 目標2：${tradePlan.target2.toFixed(2)}
- 風險報酬比：1:${tradePlan.riskReward.toFixed(2)}` : "資料不足，無法生成交易計畫"}

## 風險評分：${riskScore}/10
${riskScore >= 7 ? "⚠️ 高風險環境，建議減倉或觀望" : riskScore >= 5 ? "中等風險，注意控制倉位" : "風險可控，可正常操作"}

---
*⚠️ 此為基礎分析。設定 ANTHROPIC_API_KEY 可啟用 AI 深度分析。*`;
  }

  return `## Overall Trend
MA Trend: **${indicators.ma.status}**
MACD: ${indicators.macd.status} (DIF: ${indicators.macd.dif.toFixed(3)})

## Today's Action
${isUp ? "Bullish" : "Bearish"} candle, ${((change / prev.close) * 100).toFixed(2)}% change
Volume: ${indicators.volume.status}

## Key Levels
**Resistance:** ${resistances.map(r => r.price.toFixed(2)).join(" → ") || "None identified"}
**Support:** ${supports.map(s => s.price.toFixed(2)).join(" → ") || "None identified"}

## Trade Plan
${tradePlan ? `- Entry: ${tradePlan.entry.toFixed(2)}
- Stop Loss: ${tradePlan.stopLoss.toFixed(2)}
- Target 1: ${tradePlan.target1.toFixed(2)}
- Target 2: ${tradePlan.target2.toFixed(2)}
- Risk:Reward = 1:${tradePlan.riskReward.toFixed(2)}` : "Insufficient data"}

## Risk Score: ${riskScore}/10
${riskScore >= 7 ? "⚠️ High risk — consider reducing position" : riskScore >= 5 ? "Moderate risk — manage position size" : "Risk manageable — normal operations"}

---
*⚠️ Basic analysis. Set ANTHROPIC_API_KEY for full AI-powered deep analysis.*`;
}
