import { NextRequest, NextResponse } from "next/server";
import { OHLCV, getIndicatorSummary, calcRiskScore, calcBOLL, calcMACD, calcRSI } from "@/lib/indicators";
import { calcSupportResistance, calcTradePlan } from "@/lib/levels";

export async function POST(req: NextRequest) {
  const { periods, lang = "zh-TW" } = await req.json() as {
    symbol: string; name: string; periods: OHLCV[]; lang?: string;
  };

  if (!periods || periods.length < 20) {
    return NextResponse.json({ error: "Not enough data" }, { status: 400 });
  }

  const indicators = getIndicatorSummary(periods);
  const riskScore = calcRiskScore(periods);
  const levels = calcSupportResistance(periods);
  const tradePlan = calcTradePlan(periods, levels);
  const analysis = generateAnalysis(periods, indicators, riskScore, levels, tradePlan, lang);

  return NextResponse.json({ analysis, levels, tradePlan, riskScore });
}

function generateAnalysis(
  periods: OHLCV[],
  indicators: ReturnType<typeof getIndicatorSummary>,
  riskScore: number,
  levels: ReturnType<typeof calcSupportResistance>,
  tradePlan: ReturnType<typeof calcTradePlan>,
  lang: string
) {
  const closes = periods.map(d => d.close);
  const last = periods[periods.length - 1];
  const prev = periods[periods.length - 2];
  const change = last.close - prev.close;
  const changePct = ((change / prev.close) * 100).toFixed(2);
  const isUp = change >= 0;

  const boll = calcBOLL(closes);
  const macd = calcMACD(closes);
  const rsi = calcRSI(closes);
  const lastRsi = rsi[rsi.length - 1] ?? 50;
  const bollMid = boll.mid[boll.mid.length - 1];
  const bollUpper = boll.upper[boll.upper.length - 1];
  const bollLower = boll.lower[boll.lower.length - 1];

  const supports = levels.filter(l => l.type === "support").slice(0, 3);
  const resistances = levels.filter(l => l.type === "resistance").slice(0, 3);

  // Determine trend
  const sma20 = bollMid;
  const aboveMa = sma20 ? last.close > sma20 : false;
  const macdBullish = macd.dif[macd.dif.length - 1] > macd.dea[macd.dea.length - 1];
  const volExpanding = last.volume > indicators.volume.avg20 * 1.2;

  if (lang === "zh-TW") {
    const trend = aboveMa && macdBullish ? "多頭趨勢" : !aboveMa && !macdBullish ? "空頭趨勢" : "盤整震盪";
    const todayAction = isUp
      ? (volExpanding ? "帶量上攻，買盤積極" : "溫和反彈，量能不足")
      : (volExpanding ? "放量下殺，賣壓沉重" : "縮量回調，洗盤可能性高");

    return `## 大趨勢判斷
目前處於**${trend}**階段。
- 價格${aboveMa ? "站上" : "跌破"} MA20（${bollMid?.toFixed(2)}）
- MACD ${macdBullish ? "多頭排列" : "空頭排列"}（DIF: ${macd.dif[macd.dif.length-1].toFixed(3)}）
- 布林通道：上軌 ${bollUpper?.toFixed(2)} / 中軌 ${bollMid?.toFixed(2)} / 下軌 ${bollLower?.toFixed(2)}

## 今日盤勢性質
${isUp ? "收紅" : "收黑"} ${changePct}%，${todayAction}
- 成交量：${last.volume.toLocaleString()}（20日均量：${indicators.volume.avg20.toLocaleString()}）
- RSI(14)：${lastRsi.toFixed(1)}${lastRsi > 70 ? "（超買區）" : lastRsi < 30 ? "（超賣區）" : ""}
- KDJ：K=${indicators.kdj.k.toFixed(1)} D=${indicators.kdj.d.toFixed(1)} J=${indicators.kdj.j.toFixed(1)}

## 短線結構（1-3日）
${macdBullish && lastRsi > 50 ? "短線偏多，但注意是否遇壓回落" : !macdBullish && lastRsi < 50 ? "短線偏空，關注支撐是否守住" : "方向不明，等待突破確認"}

## 關鍵支撐與壓力
**壓力位：** ${resistances.map(r => `${r.price.toFixed(2)}（${r.strength === "strong" ? "強壓" : "中壓"}）`).join(" → ") || "無明顯壓力"}
**支撐位：** ${supports.map(s => `${s.price.toFixed(2)}（${s.strength === "strong" ? "強撐" : "中撐"}）`).join(" → ") || "無明顯支撐"}

## 交易策略建議
### 已持倉
${riskScore >= 7 ? "⚠️ 風險偏高，建議減倉或設好停損" : aboveMa ? "趨勢仍在，可續抱，停損設在支撐位下方" : "跌破均線，考慮減倉觀望"}
${tradePlan ? `- 停損參考：${tradePlan.stopLoss.toFixed(2)}` : ""}

### 想進場
${tradePlan ? `- 進場區間：${tradePlan.entry.toFixed(2)} 附近
- 停損：${tradePlan.stopLoss.toFixed(2)}
- 目標1：${tradePlan.target1.toFixed(2)}
- 目標2：${tradePlan.target2.toFixed(2)}
- 風險報酬比：1:${tradePlan.riskReward.toFixed(2)} ${tradePlan.riskReward >= 2 ? "✅ 值得" : tradePlan.riskReward >= 1 ? "⚠️ 普通" : "❌ 不划算"}` : "目前不建議追高，等回測支撐再考慮"}

## 主力意圖分析
${volExpanding && isUp ? "主力積極買入，量價配合良好" : volExpanding && !isUp ? "主力出貨跡象，放量下跌需警惕" : !volExpanding && isUp ? "散戶推動反彈，缺乏主力參與" : "縮量整理，主力可能在吸籌或觀望"}

## 風險因素
${riskScore >= 7 ? "- ⚠️ 整體風險偏高" : ""}
${lastRsi > 75 ? "- RSI 超買，短線有回調壓力" : lastRsi < 25 ? "- RSI 超賣，可能出現反彈" : ""}
${!aboveMa ? "- 價格在均線下方，趨勢偏弱" : ""}
${volExpanding && !isUp ? "- 放量下跌，賣壓明顯" : ""}
- 注意總經環境和板塊輪動影響

## 未來劇本
${aboveMa ? `**劇本A（機率 60%）：** 回測 ${bollMid?.toFixed(2)} 後反彈，目標 ${resistances[0]?.price.toFixed(2) || "前高"}
**劇本B（機率 40%）：** 跌破 ${bollMid?.toFixed(2)}，下探 ${supports[0]?.price.toFixed(2) || "前低"}` : `**劇本A（機率 55%）：** 在 ${supports[0]?.price.toFixed(2) || "支撐位"} 獲得支撐反彈
**劇本B（機率 45%）：** 跌破支撐，進入中期調整`}`;
  }

  // English version
  const trend = aboveMa && macdBullish ? "Uptrend" : !aboveMa && !macdBullish ? "Downtrend" : "Consolidation";
  const todayAction = isUp
    ? (volExpanding ? "Strong buying with volume expansion" : "Mild bounce on low volume")
    : (volExpanding ? "Heavy selling with volume spike" : "Low-volume pullback, possible shakeout");

  return `## Overall Trend
Currently in **${trend}** phase.
- Price ${aboveMa ? "above" : "below"} MA20 (${bollMid?.toFixed(2)})
- MACD ${macdBullish ? "bullish" : "bearish"} (DIF: ${macd.dif[macd.dif.length-1].toFixed(3)})
- Bollinger: Upper ${bollUpper?.toFixed(2)} / Mid ${bollMid?.toFixed(2)} / Lower ${bollLower?.toFixed(2)}

## Today's Price Action
${isUp ? "Bullish" : "Bearish"} candle, ${changePct}% — ${todayAction}
- Volume: ${last.volume.toLocaleString()} (20d avg: ${indicators.volume.avg20.toLocaleString()})
- RSI(14): ${lastRsi.toFixed(1)}${lastRsi > 70 ? " (overbought)" : lastRsi < 30 ? " (oversold)" : ""}
- KDJ: K=${indicators.kdj.k.toFixed(1)} D=${indicators.kdj.d.toFixed(1)} J=${indicators.kdj.j.toFixed(1)}

## Short-term Structure (1-3 days)
${macdBullish && lastRsi > 50 ? "Short-term bullish, watch for resistance rejection" : !macdBullish && lastRsi < 50 ? "Short-term bearish, watch if support holds" : "Directionless, wait for breakout confirmation"}

## Key Support & Resistance
**Resistance:** ${resistances.map(r => `${r.price.toFixed(2)} (${r.strength})`).join(" → ") || "None identified"}
**Support:** ${supports.map(s => `${s.price.toFixed(2)} (${s.strength})`).join(" → ") || "None identified"}

## Trading Strategy
### Already Holding
${riskScore >= 7 ? "⚠️ High risk — consider reducing or tightening stops" : aboveMa ? "Trend intact, hold with stop below support" : "Below MA — consider reducing exposure"}
${tradePlan ? `- Stop-loss reference: ${tradePlan.stopLoss.toFixed(2)}` : ""}

### Want to Enter
${tradePlan ? `- Entry zone: around ${tradePlan.entry.toFixed(2)}
- Stop-loss: ${tradePlan.stopLoss.toFixed(2)}
- Target 1: ${tradePlan.target1.toFixed(2)}
- Target 2: ${tradePlan.target2.toFixed(2)}
- Risk:Reward = 1:${tradePlan.riskReward.toFixed(2)} ${tradePlan.riskReward >= 2 ? "✅ Favorable" : tradePlan.riskReward >= 1 ? "⚠️ Marginal" : "❌ Unfavorable"}` : "Not recommended to chase — wait for support retest"}

## Institutional Flow
${volExpanding && isUp ? "Active institutional buying, volume confirms move" : volExpanding && !isUp ? "Distribution pattern — heavy selling on volume" : !volExpanding && isUp ? "Retail-driven bounce, lacking institutional participation" : "Low-volume consolidation — accumulation or indecision"}

## Risk Factors
${riskScore >= 7 ? "- ⚠️ Elevated overall risk" : ""}
${lastRsi > 75 ? "- RSI overbought — pullback likely" : lastRsi < 25 ? "- RSI oversold — bounce possible" : ""}
${!aboveMa ? "- Price below MA — weak trend" : ""}
${volExpanding && !isUp ? "- Volume spike on decline — selling pressure" : ""}
- Monitor macro environment and sector rotation

## Future Scenarios
${aboveMa ? `**Scenario A (60%):** Pullback to ${bollMid?.toFixed(2)} then bounce toward ${resistances[0]?.price.toFixed(2) || "prior high"}
**Scenario B (40%):** Break below ${bollMid?.toFixed(2)}, test ${supports[0]?.price.toFixed(2) || "prior low"}` : `**Scenario A (55%):** Find support at ${supports[0]?.price.toFixed(2) || "support"} and bounce
**Scenario B (45%):** Break support, enter medium-term correction`}`;
}
