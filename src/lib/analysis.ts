import { OHLCV, getIndicatorSummary, calcBOLL, calcMACD, calcRSI, calcKDJ, calcSMA } from "./indicators";
import { calcSupportResistance, calcTradePlan, PriceLevel, TradePlan } from "./levels";

/** Format price with appropriate decimals based on magnitude */
function fp(price: number): string {
  if (price >= 100) return price.toFixed(0);
  if (price >= 10) return price.toFixed(1);
  return price.toFixed(2);
}

function getCandleBody(c: OHLCV) { return Math.abs(c.close - c.open); }
function getCandleRange(c: OHLCV) { return c.high - c.low; }
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
  const recent = data.slice(-20);
  const closes = recent.map(d => d.close);
  const volumes = recent.map(d => d.volume);
  const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const volStd = Math.sqrt(volumes.reduce((s, v) => s + (v - avgVol) ** 2, 0) / volumes.length);
  const volCV = volStd / avgVol;
  const volScore = Math.max(0, 1 - volCV);
  let trendDays = 0;
  const sma5 = calcSMA(closes, 5);
  for (let i = 5; i < closes.length; i++) {
    if (sma5[i] !== null && sma5[i-1] !== null) {
      if ((sma5[i]! > sma5[i-1]!) === (closes[closes.length-1] > closes[0])) trendDays++;
    }
  }
  const trendScore = trendDays / Math.max(1, closes.length - 5);
  let trendVol = 0, counterVol = 0;
  const isUpTrend = closes[closes.length-1] > closes[0];
  for (let i = 1; i < recent.length; i++) {
    if ((recent[i].close > recent[i-1].close) === isUpTrend) trendVol += recent[i].volume;
    else counterVol += recent[i].volume;
  }
  const flowScore = trendVol / Math.max(1, trendVol + counterVol);
  return Math.round((volScore * 25 + trendScore * 40 + flowScore * 35));
}

function detectWashPattern(data: OHLCV[]): { isWash: boolean; characteristics: string[] } {
  const recent = data.slice(-10);
  const last = recent[recent.length - 1];
  const avgVol = data.slice(-20).reduce((s, d) => s + d.volume, 0) / 20;
  const characteristics: string[] = [];
  let isWash = false;
  const dropPct = (last.close - last.open) / last.open * 100;
  const volRatio = last.volume / avgVol;

  if (dropPct < -2 && volRatio < 1.3) {
    isWash = true;
    characteristics.push("\u8DCC\u5E45\u8F03\u5927\u4F46\u91CF\u80FD\u672A\u653E\u5927");
    characteristics.push("\u672A\u8DCC\u7834\u524D\u5E73\u53F0\u6838\u5FC3\u652F\u6490");
    characteristics.push("\u66F4\u50CF\u4E3B\u529B\u6E05\u6D17\u77ED\u7DDA\u8FFD\u9AD8\u7C4C\u78BC");
  } else if (Math.abs(dropPct) < 1 && volRatio < 0.7) {
    isWash = true;
    characteristics.push("\u91CF\u80FD\u9010\u6B65\u840E\u7E2E");
    characteristics.push("\u50F9\u683C\u7A84\u5E45\u9707\u76EA");
    characteristics.push("\u8010\u5FC3\u6D88\u78E8\u6D6E\u7C4C");
  } else if (dropPct < -1 && volRatio > 1.5) {
    characteristics.push("\u91CF\u50F9\u9F4A\u8DCC");
    characteristics.push("\u8CE3\u58D3\u660E\u986F");
    if (getLowerShadow(last) > getCandleBody(last)) {
      isWash = true;
      characteristics.push("\u4E0B\u5F71\u7DDA\u9577\uFF0C\u6709\u627F\u63A5\u529B\u9053");
    }
  }

  const recentVols = recent.slice(-5).map(d => d.volume);
  const volDecreasing = recentVols.every((v, i) => i === 0 || v <= recentVols[i-1] * 1.1);
  if (volDecreasing) characteristics.push("\u91CF\u80FD\u9010\u6B65\u840E\u7E2E");

  return { isWash, characteristics };
}

function getShortTermStructure(data: OHLCV[], macd: ReturnType<typeof calcMACD>, rsi: (number | null)[]): string {
  const closes = data.map(d => d.close);
  const last = closes.length - 1;
  const lastRsi = rsi[last] ?? 50;
  const prevRsi = rsi[last - 1] ?? 50;
  const hist = macd.histogram;
  const histTrend = hist[last] > hist[last-1] ? "\u56DE\u5347" : "\u4E0B\u964D";
  const macdCross = (macd.dif[last] > macd.dea[last]) !== (macd.dif[last-1] > macd.dea[last-1]);
  const recent6 = closes.slice(-6);
  const shortTrend = recent6[recent6.length-1] > recent6[0] ? "\u77ED\u7DDA\u8F49\u591A" : "\u77ED\u7DDA\u504F\u7A7A";
  const rsiDiverge = closes[last] > closes[last-5] && lastRsi < (rsi[last-5] ?? 50);

  if (macdCross && macd.dif[last] > macd.dea[last]) return "\u56DE\u8E29\u78BA\u8A8D\u968E\u6BB5\uFF0CMACD\u91D1\u53C9\u5F62\u6210";
  if (macdCross && macd.dif[last] < macd.dea[last]) return "\u6B7B\u53C9\u78BA\u8A8D\u968E\u6BB5\uFF0C\u77ED\u7DDA\u8F49\u5F31";
  if (histTrend === "\u56DE\u5347" && lastRsi > prevRsi) return "\u7A7A\u65B9\u529B\u91CF\u8870\u6E1B\uFF0C\u77ED\u7DDA\u8F49\u591A\u8DE1\u8C61";
  if (rsiDiverge) return "\u50F9\u683C\u65B0\u9AD8\u4F46RSI\u80CC\u96E2\uFF0C\u6CE8\u610F\u56DE\u8ABF\u98A8\u96AA";
  return `${shortTrend}\uFF0CMACD\u67F1\u72C0\u9AD4${histTrend}`;
}

export function generateFullAnalysis(
  periods: OHLCV[],
  indicators: ReturnType<typeof getIndicatorSummary>,
  riskScore: number,
  levels: PriceLevel[],
  tradePlan: TradePlan | null,
  lang: string
): string {
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
  const atr = calcATR(periods);

  const supports = levels.filter(l => l.type === "support").slice(0, 3);
  const resistances = levels.filter(l => l.type === "resistance").slice(0, 3);

  const sma20 = bollMid;
  const sma60Arr = calcSMA(closes, 60);
  const sma60 = sma60Arr[sma60Arr.length - 1];
  const aboveMa = sma20 ? last.close > sma20 : false;
  const macdBullish = macd.dif[macd.dif.length - 1] > macd.dea[macd.dea.length - 1];
  const macdDif = macd.dif[macd.dif.length - 1];
  const macdDea = macd.dea[macd.dea.length - 1];
  const volExpanding = last.volume > indicators.volume.avg20 * 1.2;

  const controlLevel = calcControlLevel(periods);
  const washPattern = detectWashPattern(periods);
  const shortStructure = getShortTermStructure(periods, macd, rsi);

  const keySupport = supports.length > 0 ? supports[0].price : (bollLower ?? last.close * 0.95);
  const keyResistance = resistances.length > 0 ? resistances[0].price : (bollUpper ?? last.close * 1.05);
  const macdGap = Math.abs(macdDif - macdDea);
  const macdConverging = macdGap < Math.abs(macd.dif[macd.dif.length - 3] - macd.dea[macd.dea.length - 3]);

  if (lang === "zh-TW") {
    const trend = aboveMa && macdBullish ? "\u4E3B\u5347\u6D6A\u672A\u7834\u58DE" : aboveMa && !macdBullish ? "\u9AD8\u4F4D\u9707\u76EA\u6574\u7406" : !aboveMa && macdBullish ? "\u5E95\u90E8\u53CD\u5F48\u521D\u671F" : "\u4E0B\u8DCC\u8DA8\u52E2\u4E2D";
    const trendDetail = aboveMa
      ? `\u80A1\u50F9\u4ECD\u5728MA20\u4E0A\u65B9\u9644\u8FD1\uFF0C\u5E03\u6797\u4E2D\u8ECC\u672A\u62D0\u982D\u5411\u4E0B\uFF0C\u65E5\u7DDAM ACD${macdBullish ? "\u591A\u982D\u6392\u5217" : "\u96D6\u6B7B\u53C9"}\uFF0C\u4F46\u4ECD\u5728\u96F6\u8EF8\u4E0A\u65B9\u3002`
      : `\u80A1\u50F9\u8DCC\u7834MA20\uFF08${sma20?.toFixed(2)}\uFF09\uFF0CMACD${macdBullish ? "\u5373\u5C07\u91D1\u53C9" : "\u7A7A\u982D\u6392\u5217"}\u3002`;
    const candleChar = isUp ? (volExpanding ? "\u5E36\u91CF\u9577\u7D05\u7A81\u7834" : "\u6EAB\u548C\u6536\u7D05") : (getCandleBody(last) > getCandleRange(last) * 0.6 ? "\u5927\u9670\u7DDA" : "\u9670\u7DDA\u56DE\u8ABF");
    const candleNarrative = isUp ? (volExpanding ? "\u91CF\u50F9\u914D\u5408\u826F\u597D\uFF0C\u591A\u65B9\u4E3B\u5C0E" : "\u53CD\u5F48\u529B\u9053\u6709\u9650\uFF0C\u91CF\u80FD\u4E0D\u8DB3\u9700\u89C0\u5BDF\u5F8C\u7E8C") : (volExpanding ? "\u653E\u91CF\u4E0B\u6BBA\uFF0C\u77ED\u7DDA\u6050\u614C\u60C5\u7DD2\u8513\u5EF6" : "\u8DCC\u5E45\u8F03\u5927\u4F46\u91CF\u80FD\u672A\u653E\u5927\uFF0C\u672A\u8DCC\u7834\u524D\u5E73\u53F0\u6838\u5FC3\u652F\u6490\uFF0C\u66F4\u50CF\u4E3B\u529B\u6E05\u6D17\u77ED\u7DDA\u8FFD\u9AD8\u7C4C\u78BC");

    const instGoals = washPattern.isWash ? ["\u6E05\u6D17\u9AD8\u4F4D\u7372\u5229\u76E4", "\u964D\u4F4E\u6D6E\u7C4C", "\u70BA\u4E0B\u4E00\u6CE2\u62C9\u5347\u6E1B\u58D3"] : volExpanding && isUp ? ["\u7A4D\u6975\u5438\u7C4C\u5EFA\u5009", "\u7A81\u7834\u95DC\u9375\u58D3\u529B\u4F4D", "\u5438\u5F15\u8DDF\u98A8\u76E4"] : ["\u63A7\u5236\u7BC0\u594F\u7B49\u5F85\u6642\u6A5F", "\u7DAD\u6301\u5340\u9593\u9707\u76EA", "\u6D88\u78E8\u6563\u6236\u8010\u5FC3"];
    const manipPath = washPattern.isWash ? ["\u6025\u6BBA\u88FD\u9020\u6050\u614C", "\u6E05\u6D17\u69D3\u687F\u8CC7\u91D1", "\u58D3\u56DE\u5747\u7DDA\u9644\u8FD1", "\u6A6B\u76E4\u9707\u76EA\u5438\u7C4C", "\u518D\u6B21\u4E0A\u653B\u65B0\u9AD8"] : ["\u7DAD\u6301\u5340\u9593\u9707\u76EA", "\u9010\u6B65\u964D\u4F4E\u6210\u672C", "\u7B49\u5F85\u50AC\u5316\u5291", "\u5FEB\u901F\u62C9\u5347\u812B\u96E2\u6210\u672C\u5340", "\u9032\u5165\u4E3B\u5347\u6D6A"];

    const holderStrategy = riskScore >= 7
      ? `\u6210\u672C\u82E5\u5728${fp(last.close * 0.95)}\u9644\u8FD1\uFF0C\u4ECD\u5728\u4E3B\u529B\u6210\u672C\u4E0A\u65B9\u3002\n\u7B56\u7565\uFF1A\u7B49\u5F85${fp(keySupport)}\u652F\u6490\u78BA\u8A8D\n\u2460 ${fp(keySupport)}\u5B88\u4F4F\n\u2461 \u51FA\u73FE\u653E\u91CF\u53CD\u5305\n\u2462 ${macdConverging ? "MACD\u5373\u5C07\u91D1\u53C9" : "MACD\u91CD\u65B0\u91D1\u53C9"}\n\u6B62\u76C8\uFF1A${tradePlan ? `${fp(tradePlan.target1)}\uFF08\u8CE3\u534A\uFF09\u2192 ${fp(tradePlan.target2)}\uFF08\u6E05\u5009\uFF09` : `${fp(keyResistance)}+`}`
      : aboveMa
      ? `\u8DA8\u52E2\u4ECD\u5728\uFF0C\u6301\u80A1\u5F85\u6F32\u3002\n\u7B56\u7565\uFF1A\u6CBF MA20\u6301\u6709\n\u2460 \u4E0D\u8DCC\u7834${fp(keySupport)}\u7E7C\u7E8C\u6301\u6709\n\u2461 \u8DCC\u7834${fp(keySupport)}\u6E1B\u534A\u5009\n\u2462 \u8DCC\u7834${fp(sma20 ?? 0)}\u5168\u90E8\u96E2\u5834\n\u6B62\u76C8\uFF1A${tradePlan ? `${fp(tradePlan.target1)}\uFF08\u8CE3\u534A\uFF09\u2192 ${fp(tradePlan.target2)}\uFF08\u6E05\u5009\uFF09` : `${fp(keyResistance)}+`}`
      : `\u5DF2\u8DCC\u7834\u5747\u7DDA\uFF0C\u5EFA\u8B70\u6E1B\u5009\u89C0\u671B\u3002\n\u2460 \u89C0\u5BDF${fp(keySupport)}\u662F\u5426\u5B88\u4F4F\n\u2461 \u7B49\u5F85MACD\u91D1\u53C9\u78BA\u8A8D\n\u2462 \u78BA\u8A8D\u5F8C\u53EF\u88DC\u56DE\u5009\u4F4D`;

    const buyerStrategy = tradePlan
      ? `\u6FC0\u9032\uFF1A${fp(keySupport)}\uFF5E${fp(keySupport + atr * 0.5)} \u5340\u57DF\n\u7A69\u5065\uFF1A\u7B49\u91CD\u65B0\u7AD9\u56DE${fp(sma20 ?? 0)}\u4EE5\u4E0A\n\u505C\u640D\uFF1A\u8DCC\u7834${fp(tradePlan.stopLoss)}\u78BA\u8A8D\u6709\u6548\n\u6B62\u76C8\uFF1A${fp(tradePlan.target1)}\uFF08\u8CE3\u534A\uFF09\u2192 ${fp(tradePlan.target2)}\uFF08\u6E05\u5009\uFF09`
      : `\u76EE\u524D\u4E0D\u5EFA\u8B70\u8FFD\u9AD8\n\u7B49\u56DE\u6E2C${fp(keySupport)}\u652F\u6490\u518D\u8003\u616E`;

    const riskFactors: string[] = [];
    if (!macdBullish) riskFactors.push(`MACD${macdConverging ? "\u5373\u5C07" : "\u5DF2"}\u6B7B\u53C9`);
    if (lastRsi > 70) riskFactors.push("RSI\u8D85\u8CB7\u5340\u57DF");
    const recentHigh = Math.max(...periods.slice(-10).map(d => d.high));
    if ((recentHigh - last.close) / recentHigh > 0.05) riskFactors.push("\u6CE2\u52D5\u5287\u70C8");
    if (volExpanding && !isUp) riskFactors.push("\u653E\u91CF\u4E0B\u8DCC");
    if (riskFactors.length === 0) riskFactors.push("\u77ED\u7DDA\u7372\u5229\u56DE\u5410\u58D3\u529B");

    const bullFactors: string[] = [];
    if (aboveMa) bullFactors.push("\u65E5\u7DDA\u7D50\u69CB\u672A\u5FB9\u5E95\u7834\u58DE");
    if (sma60 && last.close > sma60) bullFactors.push("\u4E3B\u529B\u6210\u672C\u5340\u4ECD\u5728\u4E0B\u65B9");
    if (controlLevel > 60) bullFactors.push(`\u7C4C\u78BC\u9396\u5B9A\u8F03\u597D\uFF08\u63A7\u76E4${controlLevel}%\uFF09`);
    if (macdDif > 0) bullFactors.push("MACD\u4ECD\u5728\u96F6\u8EF8\u4E0A\u65B9");
    if (bullFactors.length === 0) bullFactors.push("\u8D85\u8DCC\u5F8C\u53EF\u80FD\u6280\u8853\u6027\u53CD\u5F48");

    const probA = aboveMa ? 60 : 45;
    const probB = 100 - probA;
    const scenarioA = aboveMa ? `${fp(keySupport)}\u4F01\u7A69 \u2192 \u6A6B\u76E42-4\u5929 \u2192 \u91CD\u8FD4${fp(keyResistance)} \u2192 \u518D\u885D${fp(keyResistance + atr)}+` : `\u5728${fp(keySupport)}\u7372\u5F97\u652F\u6490 \u2192 \u53CD\u5F48\u81F3${fp(sma20 ?? 0)} \u2192 \u7A81\u7834\u5F8C\u52A0\u901F`;
    const scenarioB = aboveMa ? `\u8DCC\u7834${fp(keySupport)}\u4E14\u6536\u4E0D\u56DE \u2192 \u770B${fp(keySupport - atr)} \u2192 ${fp(keySupport - atr * 1.5)}\u9644\u8FD1` : `\u8DCC\u7834${fp(keySupport)} \u2192 \u9032\u5165\u4E2D\u671F\u8ABF\u6574 \u2192 \u770B${fp(keySupport - atr * 2)}`;

    const watchpoints = [`${fp(keySupport)}\uFF5E${fp(keySupport + atr * 0.3)}\u652F\u6490\u5F37\u5EA6`, `\u91CF\u80FD\u8B8A\u5316\uFF08\u662F\u5426\u653E\u91CF\u53CD\u5305\uFF09`, `MACD\u80FD\u5426\u91D1\u53C9\u56DE\u96F6\u8EF8\u4E0A\u65B9`, `\u7D0D\u6307\u8D70\u52E2\u8207\u5E02\u5834\u60C5\u7DD2`];

    const stopLossNote = tradePlan ? `\u8DCC\u7834${fp(tradePlan.stopLoss)}\u78BA\u8A8D\u6709\u6548` : `\u8DCC\u7834${fp(keySupport)}\u78BA\u8A8D\u6709\u6548`;
    const qualitativeChange = washPattern.isWash ? `\u7531\u6D17\u76E4 \u2192 \u8F49\u70BA\u4E2D\u7D1A\u8ABF\u6574` : `\u7531\u56DE\u8ABF \u2192 \u8F49\u70BA\u8DA8\u52E2\u53CD\u8F49`;

    return `## \u884C\u60C5\u8AAA\u660E
### \u5927\u8DA8\u52E2\uFF1A${trend}
${trendDetail}
### \u4ECA\u65E5K\u7DDA\u6027\u8CEA\uFF1A${candleChar}
${candleNarrative}
### \u77ED\u7DDA\u7D50\u69CB\uFF1A${shortStructure}
${macdConverging ? "DIF\u8207DEA\u9760\u8FD1\uFF0C\u5373\u5C07\u65B9\u5411\u9078\u64C7\u3002" : ""}\u7B2C\u4E00\u8F2A${isUp ? "\u7372\u5229" : "\u6050\u614C"}\u6BBA\u8DCC\u63A5\u8FD1\u5C3E\u8072\u3002
### \u95DC\u9375\u652F\u6490\uFF1A${fp(keySupport)}\uFF5E${fp(keySupport + atr * 0.3)}
\u524D\u7A81\u7834\u5E73\u53F0+\u65E5\u7DDA\u6838\u5FC3\u652F\u6490+\u4E3B\u529B\u77ED\u7DDA\u9632\u5B88\u4F4D

## \u4E3B\u529B\u610F\u5716\uFF08\u6DF1\u5EA6\u89E3\u6790\uFF09
### \u4E3B\u529B\u6838\u5FC3\u76EE\u6A19
${instGoals.map(g => `- ${g}`).join("\n")}
### \u6D17\u76E4\u7279\u5FB5
${washPattern.characteristics.length > 0 ? washPattern.characteristics.map(c => `\u2460 ${c}`).join("\n") : "\u2460 \u7121\u660E\u986F\u6D17\u76E4\u7279\u5FB5"}
### \u4E3B\u529B\u64CD\u4F5C\u8DEF\u5F91
${manipPath.map(p => `\u2460 ${p}`).join("\n")}
### \u4E3B\u529B\u63A7\u76E4\u7A0B\u5EA6
${"\u2588".repeat(Math.floor(controlLevel / 10))}${"\u2591".repeat(10 - Math.floor(controlLevel / 10))} ${controlLevel > 70 ? "\u8F03\u5F37" : controlLevel > 50 ? "\u4E2D\u7B49" : "\u504F\u5F31"} ${controlLevel}%

## \u4EA4\u6613\u7B56\u7565\u5EFA\u8B70
### \u60C5\u6CC11\uFF1A\u5DF2\u6301\u5009
**${riskScore >= 7 ? "\u4E0D\u5EFA\u8B70\u6050\u614C\u5272\u8089" : aboveMa ? "\u6301\u80A1\u5F85\u6F32" : "\u6E1B\u5009\u89C0\u671B"}**
${holderStrategy}
### \u60C5\u6CC12\uFF1A\u60F3\u52A0\u5009
**${riskScore >= 7 ? "\u4E0D\u9069\u5408\u8FFD\u8457\u88DC" : "\u7B49\u5F85\u66F4\u597D\u4F4D\u7F6E"}**
${buyerStrategy}
### \u6B62\u640D\u8207\u98A8\u63A7
${stopLossNote}
\u8CEA\u6027\u6539\u8B8A\uFF1A${qualitativeChange}
\u56B4\u683C\u6B62\u640D\uFF1A\u8DCC\u7834${fp(keySupport - atr)}\u6536\u76E4\u6B62\u640D

## \u98A8\u96AA\u8A55\u4F30
### \u98A8\u96AA\u56E0\u7D20
${riskFactors.map(f => `\u25CF ${f}`).join("\n")}
### \u4F46\u672A\u5230\u725B\u8F49\u718A
${bullFactors.map(f => `\u25CE ${f}`).join("\n")}

## \u672A\u4F86\u5287\u672C
### \u5287\u672CA\uFF08${probA}%\uFF09${washPattern.isWash ? "\u6D17\u76E4\u5F8C\u4E0A\u653B" : isUp ? "\u7A81\u7834\u52A0\u901F" : "\u652F\u6490\u53CD\u5F48"}
${scenarioA}
${probA >= 55 ? "\u2605\u2605\u2605\u2605\u2606" : "\u2605\u2605\u2605\u2606\u2606"}
### \u5287\u672CB\uFF08${probB}%\uFF09${!washPattern.isWash && !isUp ? "\u8DCC\u7834\u652F\u6490" : "\u56DE\u8ABF\u52A0\u6DF1"}
${scenarioB}
${probB >= 45 ? "\u2605\u2605\u2605\u2606\u2606" : "\u2605\u2605\u2606\u2606\u2606"}

## \u95DC\u9375\u95DC\u6CE8\u9EDE
${watchpoints.map(w => `\u2460 ${w}`).join("\n")}`;
  }

  // English version
  const trendEn = aboveMa && macdBullish ? "Uptrend intact" : aboveMa ? "High-level consolidation" : !aboveMa && macdBullish ? "Early bounce" : "Downtrend";
  const candleCharEn = isUp ? (volExpanding ? "Strong bullish with volume" : "Mild green candle") : (getCandleBody(last) > getCandleRange(last) * 0.6 ? "Large bearish candle" : "Pullback with support");
  const candleNarrativeEn = isUp ? (volExpanding ? "Volume confirms buying, bulls in control" : "Bounce lacks conviction") : (volExpanding ? "Heavy selling with volume spike" : `Drop of ${Math.abs(+changePct).toFixed(1)}% but volume didn't expand. Likely shakeout.`);
  const shortStructureEn = getShortTermStructure(periods, macd, rsi);

  return `## Market Narrative
### Big Picture: ${trendEn}
Price ${aboveMa ? "above" : "below"} MA20 (${sma20?.toFixed(2)}). MACD ${macdBullish ? "bullish" : "bearish"}, ${macdDif > 0 ? "above" : "below"} zero.
### Today: ${candleCharEn}
${candleNarrativeEn}
### Short-term: ${shortStructureEn}
### Key Support: ${keySupport.toFixed(2)}\u301C${(keySupport + atr * 0.3).toFixed(2)}

## Institutional Intent
### Objectives
${washPattern.isWash ? "- Flush leverage\n- Reduce float\n- Prep next leg" : "- Control pace\n- Maintain range\n- Exhaust retail"}
### Control: ${controlLevel}%
${"\u2588".repeat(Math.floor(controlLevel / 10))}${"\u2591".repeat(10 - Math.floor(controlLevel / 10))} ${controlLevel > 70 ? "Strong" : controlLevel > 50 ? "Moderate" : "Weak"}

## Trading Strategy
### Holding
**${riskScore >= 7 ? "Don't panic sell" : aboveMa ? "Hold" : "Reduce"}**
${aboveMa ? `Hold above ${fp(keySupport)}. Stop below ${fp(sma20 ?? 0)}.` : `Watch ${fp(keySupport)} support.`}
Targets: ${fp(keyResistance)} \u2192 ${fp(keyResistance + atr)}
### Adding
${tradePlan ? `Entry: ${fp(keySupport)}\u301C${fp(keySupport + atr * 0.5)}\nStop: ${fp(tradePlan.stopLoss)}\nTargets: ${fp(tradePlan.target1)} \u2192 ${fp(tradePlan.target2)}` : `Wait for ${fp(keySupport)} retest`}

## Risk
### Bearish
${!macdBullish ? "\u25CF MACD bearish\n" : ""}${volExpanding && !isUp ? "\u25CF Volume on decline\n" : ""}\u25CF Profit-taking pressure
### Bullish
${aboveMa ? "\u25CE Structure intact\n" : ""}${controlLevel > 60 ? `\u25CE ${controlLevel}% control\n` : ""}\u25CE Long-term MAs intact

## Scenarios
### A (${aboveMa ? 60 : 45}%) ${washPattern.isWash ? "Resume up" : "Support holds"}
${fp(keySupport)} holds \u2192 ${fp(keyResistance)} \u2192 ${fp(keyResistance + atr)}+
### B (${aboveMa ? 40 : 55}%) Correction
Break ${fp(keySupport)} \u2192 ${fp(keySupport - atr)} \u2192 ${fp(keySupport - atr * 1.5)}

## Watchpoints
\u2460 ${fp(keySupport)} support strength
\u2461 Volume reversal candle
\u2462 MACD golden cross
\u2463 Market sentiment`;
}
