import { NextRequest, NextResponse } from "next/server";
import { OHLCV, getIndicatorSummary, calcRiskScore, calcBOLL, calcMACD, calcRSI, calcKDJ, calcSMA, calcEMA } from "@/lib/indicators";
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

// --- Deep analysis helpers ---

function getCandleBody(c: OHLCV) { return Math.abs(c.close - c.open); }
function getCandleRange(c: OHLCV) { return c.high - c.low; }
function isRedCandle(c: OHLCV) { return c.close < c.open; }
function getUpperShadow(c: OHLCV) { return c.high - Math.max(c.open, c.close); }
function getLowerShadow(c: OHLCV) { return Math.min(c.open, c.close) - c.low; }

function calcATR(data: OHLCV[], period = 14): number {
  let sum = 0;
  const start = Math.max(1, data.length - period);
  for (let i = start; i < data.length; i++) {
    const tr = Math.max(data[i].high - data[i].low, Math.abs(data[i].high - data[i-1].close), Math.abs(data[i].low - data[i-1].close));
    sum += tr;
  }
  return sum / Math.min(period, data.length - 1);
}

function calcControlLevel(data: OHLCV[]): number {
  // Estimate institutional control: based on volume concentration, price stability, and trend consistency
  const recent = data.slice(-20);
  const closes = recent.map(d => d.close);
  const volumes = recent.map(d => d.volume);
  const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  
  // Factor 1: Volume consistency (less erratic = more controlled)
  const volStd = Math.sqrt(volumes.reduce((s, v) => s + (v - avgVol) ** 2, 0) / volumes.length);
  const volCV = volStd / avgVol; // coefficient of variation
  const volScore = Math.max(0, 1 - volCV); // lower CV = higher control
  
  // Factor 2: Price trend consistency
  let trendDays = 0;
  const sma5 = calcSMA(closes, 5);
  for (let i = 5; i < closes.length; i++) {
    if (sma5[i] !== null && sma5[i-1] !== null) {
      if ((sma5[i]! > sma5[i-1]!) === (closes[closes.length-1] > closes[0])) trendDays++;
    }
  }
  const trendScore = trendDays / Math.max(1, closes.length - 5);
  
  // Factor 3: Volume on trend days vs counter-trend days
  let trendVol = 0, counterVol = 0;
  const isUpTrend = closes[closes.length-1] > closes[0];
  for (let i = 1; i < recent.length; i++) {
    if ((recent[i].close > recent[i-1].close) === isUpTrend) trendVol += recent[i].volume;
    else counterVol += recent[i].volume;
  }
  const flowScore = trendVol / Math.max(1, trendVol + counterVol);
  
  return Math.round((volScore * 25 + trendScore * 40 + flowScore * 35));
}

function detectWashPattern(data: OHLCV[]): { isWash: boolean; type: string; characteristics: string[] } {
  const recent = data.slice(-10);
  const last = recent[recent.length - 1];
  const avgVol = data.slice(-20).reduce((s, d) => s + d.volume, 0) / 20;
  
  const characteristics: string[] = [];
  let isWash = false;
  let type = "";
  
  // Check for sharp drop without volume expansion (wash pattern)
  const dropPct = (last.close - last.open) / last.open * 100;
  const volRatio = last.volume / avgVol;
  
  if (dropPct < -2 && volRatio < 1.3) {
    isWash = true;
    type = "急殺洗槓桿";
    characteristics.push("跌幅較大但量能未放大");
    characteristics.push("未跌破前平台核心支撐");
    characteristics.push("更像主力清洗短線追高籌碼");
  } else if (Math.abs(dropPct) < 1 && volRatio < 0.7) {
    isWash = true;
    type = "縮量橫盤洗盤";
    characteristics.push("量能逐步萎縮");
    characteristics.push("價格窄幅震盪");
    characteristics.push("耐心消磨浮籌");
  } else if (dropPct < -1 && volRatio > 1.5) {
    type = "放量下殺";
    characteristics.push("量價齊跌");
    characteristics.push("賣壓明顯");
    if (getLowerShadow(last) > getCandleBody(last)) {
      isWash = true;
      characteristics.push("下影線長，有承接力道");
    }
  } else if (dropPct > 2 && volRatio > 1.3) {
    type = "帶量突破";
    characteristics.push("量價配合");
    characteristics.push("突破意圖明確");
  } else {
    type = "正常波動";
  }
  
  // Check staircase pattern (階梯式壓盤)
  let stairDown = 0;
  for (let i = recent.length - 5; i < recent.length; i++) {
    if (i > 0 && recent[i].high < recent[i-1].high) stairDown++;
  }
  if (stairDown >= 3) characteristics.push("階梯式壓盤");
  
  // Check volume shrinkage pattern
  const recentVols = recent.slice(-5).map(d => d.volume);
  const volDecreasing = recentVols.every((v, i) => i === 0 || v <= recentVols[i-1] * 1.1);
  if (volDecreasing) characteristics.push("量能逐步萎縮");
  
  return { isWash, type, characteristics };
}

function getShortTermStructure(data: OHLCV[], macd: ReturnType<typeof calcMACD>, rsi: (number | null)[]): string {
  const closes = data.map(d => d.close);
  const last = closes.length - 1;
  const lastRsi = rsi[last] ?? 50;
  const prevRsi = rsi[last - 1] ?? 50;
  
  // Check MACD histogram trend
  const hist = macd.histogram;
  const histTrend = hist[last] > hist[last-1] ? "回升" : "下降";
  const macdCross = (macd.dif[last] > macd.dea[last]) !== (macd.dif[last-1] > macd.dea[last-1]);
  
  // Check 1h-equivalent (use last 6 candles as proxy for intraday)
  const recent6 = closes.slice(-6);
  const shortTrend = recent6[recent6.length-1] > recent6[0] ? "短線轉多" : "短線偏空";
  
  // Bearish divergence check
  const rsiDiverge = closes[last] > closes[last-5] && lastRsi < (rsi[last-5] ?? 50);
  
  if (macdCross && macd.dif[last] > macd.dea[last]) return "回踩確認階段，MACD金叉形成";
  if (macdCross && macd.dif[last] < macd.dea[last]) return "死叉確認階段，短線轉弱";
  if (histTrend === "回升" && lastRsi > prevRsi) return "空方力量衰減，短線轉多跡象";
  if (rsiDiverge) return "價格新高但RSI背離，注意回調風險";
  return `${shortTrend}，MACD柱狀體${histTrend}`;
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
  const kdj = calcKDJ(periods);
  const lastRsi = rsi[rsi.length - 1] ?? 50;
  const bollMid = boll.mid[boll.mid.length - 1];
  const bollUpper = boll.upper[boll.upper.length - 1];
  const bollLower = boll.lower[boll.lower.length - 1];
  const atr = calcATR(periods);

  const supports = levels.filter(l => l.type === "support").slice(0, 3);
  const resistances = levels.filter(l => l.type === "resistance").slice(0, 3);

  const sma20 = bollMid;
  const sma5Arr = calcSMA(closes, 5);
  const sma5 = sma5Arr[sma5Arr.length - 1];
  const sma60Arr = calcSMA(closes, 60);
  const sma60 = sma60Arr[sma60Arr.length - 1];
  const aboveMa = sma20 ? last.close > sma20 : false;
  const macdBullish = macd.dif[macd.dif.length - 1] > macd.dea[macd.dea.length - 1];
  const macdDif = macd.dif[macd.dif.length - 1];
  const macdDea = macd.dea[macd.dea.length - 1];
  const volExpanding = last.volume > indicators.volume.avg20 * 1.2;
  const volRatio = (last.volume / indicators.volume.avg20).toFixed(2);

  // Deep analysis
  const controlLevel = calcControlLevel(periods);
  const washPattern = detectWashPattern(periods);
  const shortStructure = getShortTermStructure(periods, macd, rsi);

  // Candle character analysis
  const bodyPct = (getCandleBody(last) / last.open * 100).toFixed(2);
  const upperShadowPct = (getUpperShadow(last) / getCandleRange(last) * 100).toFixed(0);
  const lowerShadowPct = (getLowerShadow(last) / getCandleRange(last) * 100).toFixed(0);
  
  // Key support zone
  const keySupport = supports.length > 0 ? supports[0].price : (bollLower ?? last.close * 0.95);
  const keyResistance = resistances.length > 0 ? resistances[0].price : (bollUpper ?? last.close * 1.05);

  // Determine if MACD is about to cross
  const macdGap = Math.abs(macdDif - macdDea);
  const macdConverging = macdGap < Math.abs(macd.dif[macd.dif.length - 3] - macd.dea[macd.dea.length - 3]);

  if (lang === "zh-TW") {
    const trend = aboveMa && macdBullish ? "主升浪未破壞" 
      : aboveMa && !macdBullish ? "高位震盪整理"
      : !aboveMa && macdBullish ? "底部反彈初期"
      : "下跌趨勢中";
    
    const trendDetail = aboveMa 
      ? `股價仍在MA20上方附近，布林中軌未拐頭向下，日線MACD${macdBullish ? "多頭排列" : "雖死叉"}，但仍在零軸上方。`
      : `股價跌破MA20（${sma20?.toFixed(2)}），布林中軌開始走平/下彎，MACD${macdBullish ? "即將金叉" : "空頭排列"}。`;

    // Today's candle character
    const candleChar = isUp 
      ? (volExpanding ? "帶量長紅突破" : getCandleBody(last) < getCandleRange(last) * 0.3 ? "十字星猶豫" : "溫和收紅")
      : (getCandleBody(last) > getCandleRange(last) * 0.6 ? "大陰線" : getLowerShadow(last) > getCandleBody(last) ? "下影線長，有承接" : "陰線回調");
    
    const candleNarrative = isUp
      ? (volExpanding ? "量價配合良好，多方主導" : "反彈力道有限，量能不足需觀察後續")
      : (volExpanding ? "放量下殺，短線恐慌情緒蔓延" : "跌幅較大但量能未放大，未跌破前平台核心支撐，更像主力清洗短線追高籌碼");

    // Institutional intent
    const instGoals = [];
    if (washPattern.isWash) {
      instGoals.push("清洗高位獲利盤");
      instGoals.push("降低浮籌");
      instGoals.push("為下一波拉升減壓");
    } else if (volExpanding && isUp) {
      instGoals.push("積極吸籌建倉");
      instGoals.push("突破關鍵壓力位");
      instGoals.push("吸引跟風盤");
    } else if (volExpanding && !isUp) {
      instGoals.push("高位派發出貨");
      instGoals.push("製造恐慌情緒");
      instGoals.push("壓低吸籌或離場");
    } else {
      instGoals.push("控制節奏等待時機");
      instGoals.push("維持區間震盪");
      instGoals.push("消磨散戶耐心");
    }

    // Manipulation path
    const manipPath = washPattern.isWash
      ? ["急殺製造恐慌", "清洗槓桿資金", "壓回均線附近", "橫盤震盪吸籌", "再次上攻新高"]
      : volExpanding && isUp
      ? ["底部吸籌完成", "突破關鍵壓力", "回踩確認支撐", "加速拉升", "高位派發"]
      : ["維持區間震盪", "逐步降低成本", "等待催化劑", "快速拉升脫離成本區", "進入主升浪"];

    // Strategy for holders
    const holderStrategy = riskScore >= 7
      ? `成本若在${(last.close * 0.95).toFixed(0)}附近，仍在主力成本上方。\n策略：等待${keySupport.toFixed(0)}支撐確認\n① ${keySupport.toFixed(0)}守住\n② 出現放量反包\n③ ${macdConverging ? "MACD即將金叉" : "MACD重新金叉"}\n結果：大概率開啟第二波上攻\n目標位：${keyResistance.toFixed(0)} → ${(keyResistance + atr).toFixed(0)} → ${(keyResistance + atr * 2).toFixed(0)}+`
      : aboveMa
      ? `趨勢仍在，持股待漲。\n策略：沿MA20持有\n① 不跌破${sma20?.toFixed(0)}繼續持有\n② 跌破${sma20?.toFixed(0)}減半倉\n③ 跌破${keySupport.toFixed(0)}全部離場\n目標位：${keyResistance.toFixed(0)} → ${(keyResistance + atr).toFixed(0)}`
      : `已跌破均線，建議減倉觀望。\n策略：等待企穩信號\n① 觀察${keySupport.toFixed(0)}是否守住\n② 等待MACD金叉確認\n③ 確認後可補回倉位`;

    // Strategy for new buyers
    const buyerStrategy = tradePlan
      ? `激進：${keySupport.toFixed(0)}～${(keySupport + atr * 0.5).toFixed(0)} 區域\n穩健：等重新站回${sma20?.toFixed(0)}以上\n停損：跌破${tradePlan.stopLoss.toFixed(0)}確認有效\n目標：${tradePlan.target1.toFixed(0)} → ${tradePlan.target2.toFixed(0)}`
      : `目前不建議追高\n等回測${keySupport.toFixed(0)}支撐再考慮`;

    // Risk factors (bearish)
    const riskFactors: string[] = [];
    if (!aboveMa) riskFactors.push("日線高位回落");
    if (!macdBullish) riskFactors.push(`MACD${macdConverging ? "即將" : "已"}死叉`);
    if (last.close < (sma5 ?? last.close)) riskFactors.push("跌破短線趨勢");
    if (lastRsi > 70) riskFactors.push("RSI超買區域");
    const recentHigh = Math.max(...periods.slice(-10).map(d => d.high));
    if ((recentHigh - last.close) / recentHigh > 0.05) riskFactors.push("波動劇烈");
    if (volExpanding && !isUp) riskFactors.push("放量下跌");
    if (indicators.kdj.j > 80) riskFactors.push("KDJ高位鈍化");
    if (riskFactors.length === 0) riskFactors.push("短線獲利回吐壓力");

    // Bullish factors
    const bullFactors: string[] = [];
    if (aboveMa) bullFactors.push("日線結構未徹底破壞");
    if (sma60 && last.close > sma60) bullFactors.push("主力成本區仍在下方");
    if (sma20 && sma60 && sma20 > sma60) bullFactors.push("長期均線未死叉");
    if (washPattern.isWash) bullFactors.push("洗盤特徵明顯，非真跌");
    if (controlLevel > 60) bullFactors.push(`籌碼鎖定較好（控盤${controlLevel}%）`);
    if (macdDif > 0) bullFactors.push("MACD仍在零軸上方");
    if (bullFactors.length === 0) bullFactors.push("超跌後可能技術性反彈");

    // Scenarios
    const scenarioA = aboveMa
      ? `${keySupport.toFixed(0)}企穩 → 橫盤2-4天 → 重返${keyResistance.toFixed(0)} → 再衝${(keyResistance + atr).toFixed(0)}+`
      : `在${keySupport.toFixed(0)}獲得支撐 → 反彈至${sma20?.toFixed(0)} → 突破後加速`;
    const scenarioB = aboveMa
      ? `跌破${keySupport.toFixed(0)}且收不回 → 看${(keySupport - atr).toFixed(0)} → ${(keySupport - atr * 1.5).toFixed(0)}附近`
      : `跌破${keySupport.toFixed(0)} → 進入中期調整 → 看${(keySupport - atr * 2).toFixed(0)}`;
    const probA = aboveMa ? 60 : 45;
    const probB = 100 - probA;

    // Key watchpoints
    const watchpoints: string[] = [];
    watchpoints.push(`${keySupport.toFixed(0)}～${(keySupport + atr * 0.3).toFixed(0)}支撐強度`);
    watchpoints.push(`量能變化（是否放量反包）`);
    watchpoints.push(`MACD能否金叉回零軸上方`);
    watchpoints.push(`納指走勢與市場情緒`);
    if (macdConverging) watchpoints.push(`DIF/DEA即將交叉，方向確認`);

    // Stop loss / risk control section
    const stopLossNote = tradePlan 
      ? `跌破${tradePlan.stopLoss.toFixed(0)}確認有效\n且連續收不回來`
      : `跌破${keySupport.toFixed(0)}確認有效`;
    const qualitativeChange = washPattern.isWash
      ? `由洗盤 → 轉為中級調整`
      : `由回調 → 轉為趨勢反轉`;

    return `## 行情說明
### 大趨勢：${trend}
${trendDetail}
### 今日K線性質：${candleChar}
${candleNarrative}
### 短線結構：${shortStructure}
${macdConverging ? "DIF與DEA靠近，即將方向選擇。" : ""}第一輪${isUp ? "獲利" : "恐慌"}殺跌接近尾聲。
### 關鍵支撐：${keySupport.toFixed(0)}～${(keySupport + atr * 0.3).toFixed(0)}
前突破平台+日線核心支撐+主力短線防守位

## 主力意圖（深度解析）
### 主力核心目標
${instGoals.map(g => `- ${g}`).join("\n")}
### 洗盤特徵
${washPattern.characteristics.length > 0 ? washPattern.characteristics.map((c) => `① ${c}`).join("\n") : "① 無明顯洗盤特徵"}
- 節奏可控
### 主力操作路徑
${manipPath.map((p) => `① ${p}`).join("\n")}
### 主力控盤程度
${"█".repeat(Math.floor(controlLevel / 10))}${"░".repeat(10 - Math.floor(controlLevel / 10))} ${controlLevel > 70 ? "較強" : controlLevel > 50 ? "中等" : "偏弱"} ${controlLevel}%
${controlLevel > 60 ? "籌碼鎖定較好，仍以多頭控盤為主" : "籌碼較為分散，方向待確認"}

## 交易策略建議
### 情況1：已持倉
**${riskScore >= 7 ? "不建議恐慌割肉" : aboveMa ? "持股待漲" : "減倉觀望"}**
${holderStrategy}
### 情況2：想加倉
**${riskScore >= 7 ? "不適合追著補" : "等待更好位置"}**
${buyerStrategy}
### 止損與風控
${stopLossNote}
質性改變：${qualitativeChange}
嚴格止損：跌破${(keySupport - atr).toFixed(0)}收盤止損

## 風險評估
### 風險因素
${riskFactors.map(f => `● ${f}`).join("\n")}
### 但未到牛轉熊
${bullFactors.map(f => `◎ ${f}`).join("\n")}

## 未來劇本
### 劇本A（${probA}%）${washPattern.isWash ? "洗盤後上攻" : isUp ? "突破加速" : "支撐反彈"}
${scenarioA}
${probA >= 55 ? "★★★★☆" : "★★★☆☆"}
### 劇本B（${probB}%）${!washPattern.isWash && !isUp ? "跌破支撐" : "回調加深"}
${scenarioB}
${probB >= 45 ? "★★★☆☆" : "★★☆☆☆"}

## 關鍵關注點
${watchpoints.map((w, i) => `① ${w}`).join("\n")}`;
  }

  // --- English version ---
  const trendEn = aboveMa && macdBullish ? "Uptrend intact" 
    : aboveMa && !macdBullish ? "High-level consolidation"
    : !aboveMa && macdBullish ? "Early bounce from bottom"
    : "Downtrend";

  const candleCharEn = isUp
    ? (volExpanding ? "Strong bullish candle with volume" : "Mild green candle")
    : (getCandleBody(last) > getCandleRange(last) * 0.6 ? "Large bearish candle" : "Pullback with support");

  const candleNarrativeEn = isUp
    ? (volExpanding ? "Volume confirms buying pressure, bulls in control" : "Bounce lacks conviction, volume below average")
    : (volExpanding ? "Heavy selling with volume spike — panic selling" : `Drop of ${Math.abs(+changePct).toFixed(1)}% but volume didn't expand significantly. Didn't break core support. Likely a leverage flush / shakeout by institutions.`);

  const shortStructureEn = getShortTermStructure(periods, macd, rsi);

  return `## Market Narrative
### Big Picture: ${trendEn}
Price ${aboveMa ? "above" : "below"} MA20 (${sma20?.toFixed(2)}). MACD ${macdBullish ? "bullish" : "bearish"}, ${macdDif > 0 ? "above" : "below"} zero line.
### Today's Candle: ${candleCharEn}
${candleNarrativeEn}
### Short-term: ${shortStructureEn}
${macdConverging ? "DIF/DEA converging." : ""}First wave of ${isUp ? "profit-taking" : "panic"} nearing exhaustion.
### Key Support: ${keySupport.toFixed(2)}～${(keySupport + atr * 0.3).toFixed(2)}

## Institutional Intent
### Core Objectives
${washPattern.isWash ? "- Flush leveraged positions\n- Reduce floating shares\n- Prepare for next leg up" : volExpanding && isUp ? "- Active accumulation\n- Break key resistance\n- Attract momentum traders" : "- Control pace and timing\n- Maintain range\n- Exhaust retail patience"}
### ${washPattern.isWash ? "Wash" : "Market"} Characteristics
${washPattern.characteristics.length > 0 ? washPattern.characteristics.map((c, i) => `${i+1}. ${c}`).join("\n") : "1. Normal fluctuation"}
### Manipulation Path
① ${washPattern.isWash ? "Sharp drop → panic" : "Accumulate at support"}
② ${washPattern.isWash ? "Flush leveraged longs" : "Test resistance"}
③ ${washPattern.isWash ? "Push back to MAs" : "Consolidate gains"}
④ ${washPattern.isWash ? "Sideways accumulation" : "Break out with volume"}
⑤ ${washPattern.isWash ? "Launch next leg up" : "Distribute at highs"}
### Control: ${controlLevel}%
${"█".repeat(Math.floor(controlLevel / 10))}${"░".repeat(10 - Math.floor(controlLevel / 10))} ${controlLevel > 70 ? "Strong" : controlLevel > 50 ? "Moderate" : "Weak"}

## Trading Strategy
### Already Holding
**${riskScore >= 7 ? "Don't panic sell" : aboveMa ? "Hold with trend" : "Consider reducing"}**
${riskScore >= 7 ? `Cost near ${(last.close * 0.95).toFixed(0)}, above institutional cost.\n① Hold ${keySupport.toFixed(0)}\n② Watch for volume reversal\n③ ${macdConverging ? "MACD about to golden cross" : "Wait for MACD golden cross"}\nTargets: ${keyResistance.toFixed(0)} → ${(keyResistance + atr).toFixed(0)}+` : `Hold along MA20. Stop below ${keySupport.toFixed(0)}`}
### Want to Add
**${riskScore >= 7 ? "Not ideal to chase" : "Wait for better entry"}**
${tradePlan ? `Aggressive: ${keySupport.toFixed(0)}～${(keySupport + atr * 0.5).toFixed(0)}\nConservative: Reclaim ${sma20?.toFixed(0)}\nStop: ${tradePlan.stopLoss.toFixed(0)}\nTargets: ${tradePlan.target1.toFixed(0)} → ${tradePlan.target2.toFixed(0)}` : `Wait for retest at ${keySupport.toFixed(0)}`}
### Stop Loss
Hard stop: below ${(keySupport - atr).toFixed(0)} on close
Change: ${washPattern.isWash ? "Shakeout → real correction" : "Pullback → trend reversal"}

## Risk Assessment
### Bearish Factors
${riskScore >= 7 ? "● Elevated overall risk\n" : ""}${!macdBullish ? "● MACD bearish cross\n" : ""}${!aboveMa ? "● Below key MA\n" : ""}${volExpanding && !isUp ? "● Volume spike on decline\n" : ""}${lastRsi > 75 ? "● RSI overbought\n" : ""}● Profit-taking pressure
### But Not Yet Bear
${aboveMa ? "◎ Daily structure intact\n" : ""}${sma60 && last.close > sma60 ? "◎ Institutional cost below\n" : ""}${controlLevel > 60 ? `◎ ${controlLevel}% control\n` : ""}${macdDif > 0 ? "◎ MACD above zero\n" : ""}◎ Long-term MAs intact

## Future Scenarios
### A (${aboveMa ? 60 : 45}%) ${washPattern.isWash ? "Resume uptrend" : "Support holds"}
${keySupport.toFixed(0)} holds → ${keyResistance.toFixed(0)} → ${(keyResistance + atr).toFixed(0)}+
${aboveMa ? "★★★★☆" : "★★★☆☆"}
### B (${aboveMa ? 40 : 55}%) Deeper correction
Break ${keySupport.toFixed(0)} → ${(keySupport - atr).toFixed(0)} → ${(keySupport - atr * 1.5).toFixed(0)}
${!aboveMa ? "★★★☆☆" : "★★☆☆☆"}

## Key Watchpoints
① ${keySupport.toFixed(0)}～${(keySupport + atr * 0.3).toFixed(0)} support strength
② Volume change (watch for reversal candle)
③ MACD golden cross above zero line
④ Index trend & market sentiment
${macdConverging ? "⑤ DIF/DEA about to cross — direction confirmation" : ""}`;
}
