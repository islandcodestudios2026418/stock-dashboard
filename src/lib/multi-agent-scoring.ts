// Multi-agent scoring: 5 independent analyst perspectives score each stock.
// All 5 must agree (score >= threshold) before flagging a stock as a consensus pick.
// Optimized for SNDK-like explosive stocks: consensus should be RARE.

import { OHLCV, calcEMA, calcMACD, calcRSI, calcKDJ, calcBOLL, calcSMA, calcADX, calcAccumulation } from "./indicators";

export interface AgentScore {
  agent: string;
  score: number; // 0-100
  signal: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
  reasoning: string;
}

export interface ConsensusResult {
  symbol: string;
  consensus: boolean;
  avgScore: number;
  agents: AgentScore[];
  recommendation: string;
}

const CONSENSUS_THRESHOLD = 65; // Balance: selective enough to be rare, achievable for true breakouts

function toSignal(score: number): AgentScore["signal"] {
  if (score >= 80) return "STRONG_BUY";
  if (score >= 65) return "BUY";
  if (score >= 40) return "NEUTRAL";
  if (score >= 20) return "SELL";
  return "STRONG_SELL";
}

// Agent 1: Macro/Structural — long-term trend + relative strength
export function scoreMacro(data: OHLCV[]): AgentScore {
  const closes = data.map(d => d.close);
  const last = closes.length - 1;
  let score = 40; // Start lower — must earn points
  const reasons: string[] = [];

  // Golden cross (EMA50 > EMA200)
  const ema50 = calcEMA(closes, Math.min(50, closes.length - 1));
  const ema200 = calcEMA(closes, Math.min(200, closes.length - 1));
  if (ema50[last] > ema200[last]) {
    score += 12;
    reasons.push("EMA50>200");
  } else {
    score -= 15;
    reasons.push("EMA50<200 結構空頭");
  }

  // Price above 200EMA
  if (closes[last] > ema200[last]) score += 8;
  else score -= 10;

  // 6-month relative momentum (must outperform significantly)
  const sixMonthAgo = Math.max(0, last - 126);
  const sixMonthReturn = (closes[last] - closes[sixMonthAgo]) / closes[sixMonthAgo];
  if (sixMonthReturn > 0.5) { score += 20; reasons.push(`6月漲${(sixMonthReturn * 100).toFixed(0)}%爆發`); }
  else if (sixMonthReturn > 0.2) { score += 12; reasons.push(`6月漲${(sixMonthReturn * 100).toFixed(0)}%`); }
  else if (sixMonthReturn > 0) { score += 3; }
  else { score -= 12; reasons.push(`6月跌${(sixMonthReturn * 100).toFixed(0)}%`); }

  // New high breakout (must be AT the high, not just near)
  const high60 = Math.max(...closes.slice(-60));
  if (closes[last] >= high60) {
    score += 12;
    reasons.push("突破60日新高");
  } else if (closes[last] >= high60 * 0.97) {
    score += 5;
    reasons.push("接近60日高");
  }

  // 3-month acceleration (2nd derivative: recent momentum > earlier momentum)
  const threeMonthAgo = Math.max(0, last - 63);
  const firstHalf = (closes[threeMonthAgo] - closes[sixMonthAgo]) / closes[sixMonthAgo];
  const secondHalf = (closes[last] - closes[threeMonthAgo]) / closes[threeMonthAgo];
  if (secondHalf > firstHalf && secondHalf > 0.1) {
    score += 8;
    reasons.push("動能加速中");
  }

  return { agent: "Macro(總經)", score: Math.max(0, Math.min(100, score)), signal: toSignal(score), reasoning: reasons.join("; ") };
}

// Agent 2: Technical Analysis — ADX, MACD, RSI, volume
export function scoreTechnical(data: OHLCV[]): AgentScore {
  const closes = data.map(d => d.close);
  const last = closes.length - 1;
  let score = 40;
  const reasons: string[] = [];

  // ADX — trend strength (>25 = trending, >40 = strong trend)
  const adx = calcADX(data);
  const adxVal = adx[last] || 0;
  if (adxVal > 40) { score += 15; reasons.push(`ADX=${adxVal.toFixed(0)}強趨勢`); }
  else if (adxVal > 25) { score += 8; reasons.push(`ADX=${adxVal.toFixed(0)}趨勢中`); }
  else { score -= 5; reasons.push(`ADX=${adxVal.toFixed(0)}無趨勢`); }

  // MACD — golden cross gets bonus
  const macd = calcMACD(closes);
  if (macd.dif[last] > macd.dea[last] && macd.dif[last - 1] <= macd.dea[last - 1]) {
    score += 12; reasons.push("MACD金叉");
  } else if (macd.dif[last] > macd.dea[last] && macd.histogram[last] > macd.histogram[last - 1]) {
    score += 7; reasons.push("MACD多頭加速");
  } else if (macd.dif[last] > macd.dea[last]) {
    score += 3;
  } else {
    score -= 8;
  }

  // RSI — sweet spot 55-70 for momentum stocks
  const rsi = calcRSI(closes);
  const rsiVal = rsi[last] ?? 50;
  if (rsiVal >= 55 && rsiVal <= 70) { score += 10; reasons.push(`RSI=${rsiVal.toFixed(0)}健康`); }
  else if (rsiVal > 70 && rsiVal <= 80) { score += 3; reasons.push("RSI偏高但可追"); }
  else if (rsiVal > 80) { score -= 10; reasons.push("RSI超買風險"); }
  else if (rsiVal < 40) { score -= 8; reasons.push("RSI弱勢"); }

  // Volume confirmation — must have volume on breakout
  const avgVol = data.slice(-20).reduce((s, d) => s + d.volume, 0) / 20;
  if (data[last].volume > avgVol * 2 && closes[last] > closes[last - 1]) {
    score += 12; reasons.push("倍量突破");
  } else if (data[last].volume > avgVol * 1.5 && closes[last] > closes[last - 1]) {
    score += 6; reasons.push("放量上漲");
  }

  // Bollinger squeeze breakout (volatility expansion)
  const boll = calcBOLL(closes);
  if (boll.upper[last] && boll.lower[last] && boll.upper[last - 10] && boll.lower[last - 10]) {
    const bw = (boll.upper[last]! - boll.lower[last]!) / (boll.mid[last] || 1);
    const bwPrev = (boll.upper[last - 10]! - boll.lower[last - 10]!) / (boll.mid[last - 10] || 1);
    if (bw > bwPrev * 1.3 && closes[last] > boll.upper[last]! * 0.98) {
      score += 8; reasons.push("布林帶擴張突破");
    }
  }

  return { agent: "Technical(技術)", score: Math.max(0, Math.min(100, score)), signal: toSignal(score), reasoning: reasons.join("; ") };
}

// Agent 3: Sentiment/News — price-action proxy for institutional activity
export function scoreSentiment(data: OHLCV[]): AgentScore {
  const closes = data.map(d => d.close);
  const last = closes.length - 1;
  let score = 40;
  const reasons: string[] = [];

  // Gap ups in last 20 days (institutional catalyst signals)
  const recentGaps = data.slice(-20).filter((d, i, arr) => i > 0 && d.open > arr[i - 1].close * 1.015);
  if (recentGaps.length >= 3) { score += 18; reasons.push(`${recentGaps.length}次跳空(主力進場)`); }
  else if (recentGaps.length >= 2) { score += 10; reasons.push(`${recentGaps.length}次跳空`); }
  else if (recentGaps.length >= 1) { score += 4; }

  // Consecutive up days
  let upDays = 0;
  for (let i = last; i > last - 10 && i > 0; i--) {
    if (closes[i] > closes[i - 1]) upDays++; else break;
  }
  if (upDays >= 5) { score += 12; reasons.push(`連漲${upDays}日`); }
  else if (upDays >= 3) { score += 6; reasons.push(`連漲${upDays}日`); }

  // Volume surge (20-day vs 60-day comparison — more stable)
  const avgVol60 = data.slice(-60).reduce((s, d) => s + d.volume, 0) / 60;
  const avgVol10 = data.slice(-10).reduce((s, d) => s + d.volume, 0) / 10;
  const volRatio = avgVol60 > 0 ? avgVol10 / avgVol60 : 1;
  if (volRatio > 2.5) { score += 15; reasons.push(`量能2.5倍(搶貨)`); }
  else if (volRatio > 1.8) { score += 10; reasons.push(`量能${volRatio.toFixed(1)}倍`); }
  else if (volRatio > 1.3) { score += 5; reasons.push("溫和放量"); }

  // Wide range candles closing near high (buying pressure)
  const recent = data.slice(-5);
  const strongCandles = recent.filter(d => {
    const range = d.high - d.low;
    return range > 0 && (d.close - d.low) / range > 0.75 && (d.close - d.open) / d.open > 0.01;
  });
  if (strongCandles.length >= 4) { score += 10; reasons.push("連續強勢K線"); }
  else if (strongCandles.length >= 3) { score += 6; reasons.push("多根強勢K線"); }

  // Up-volume ratio: % of 10-day volume on up-days
  const last10 = data.slice(-10);
  const upVol = last10.filter(d => d.close > d.open).reduce((s, d) => s + d.volume, 0);
  const totalVol = last10.reduce((s, d) => s + d.volume, 0);
  const upVolRatio = totalVol > 0 ? upVol / totalVol : 0.5;
  if (upVolRatio > 0.75) { score += 8; reasons.push(`上漲量佔${(upVolRatio * 100).toFixed(0)}%`); }

  return { agent: "Sentiment(消息)", score: Math.max(0, Math.min(100, score)), signal: toSignal(score), reasoning: reasons.join("; ") };
}

// Agent 4: Fundamentals — volume accumulation + price quality
export function scoreFundamentals(data: OHLCV[]): AgentScore {
  const closes = data.map(d => d.close);
  const last = closes.length - 1;
  let score = 40;
  const reasons: string[] = [];

  // Volume accumulation (smart money detection)
  const accum = calcAccumulation(data, 20);
  if (accum.score > 0.7 && accum.obv_trend > 0) {
    score += 18; reasons.push(`量能集中買方(${(accum.score * 100).toFixed(0)}%)`);
  } else if (accum.score > 0.6) {
    score += 8; reasons.push("買方量能偏多");
  } else if (accum.score < 0.4) {
    score -= 10; reasons.push("賣方量能主導");
  }

  // Quality uptrend: positive returns with low volatility
  const returns = closes.slice(-60).map((c, i, a) => i === 0 ? 0 : (c - a[i - 1]) / a[i - 1]);
  const vol = Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / returns.length);
  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const sharpe = vol > 0 ? avgReturn / vol : 0;

  if (sharpe > 0.15) { score += 15; reasons.push(`高品質漲勢(Sharpe=${sharpe.toFixed(2)})`); }
  else if (sharpe > 0.05) { score += 5; }
  else if (avgReturn < 0) { score -= 12; reasons.push("負報酬"); }

  // New highs frequency (institutional demand)
  const highs = closes.slice(-60);
  let newHighCount = 0;
  let runningMax = highs[0];
  for (let i = 1; i < highs.length; i++) {
    if (highs[i] > runningMax) { newHighCount++; runningMax = highs[i]; }
  }
  if (newHighCount >= 8) { score += 15; reasons.push(`60日${newHighCount}次新高`); }
  else if (newHighCount >= 4) { score += 7; reasons.push(`${newHighCount}次新高`); }

  // EMA spread acceleration
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, Math.min(50, closes.length - 1));
  const spread = ema20[last] - ema50[last];
  const prevSpread = ema20[Math.max(0, last - 10)] - ema50[Math.max(0, last - 10)];
  if (spread > prevSpread && spread > 0) {
    score += 8; reasons.push("均線擴張加速");
  }

  return { agent: "Fundamentals(基本面)", score: Math.max(0, Math.min(100, score)), signal: toSignal(score), reasoning: reasons.join("; ") };
}

// Agent 5: Risk Manager — stricter risk controls
export function scoreRisk(data: OHLCV[]): AgentScore {
  const closes = data.map(d => d.close);
  const last = closes.length - 1;
  let score = 75; // Start high, subtract for risk
  const reasons: string[] = [];

  // Max drawdown in last 60 days
  let peak = closes[Math.max(0, last - 59)];
  let maxDD = 0;
  for (let i = Math.max(0, last - 59); i <= last; i++) {
    peak = Math.max(peak, closes[i]);
    maxDD = Math.min(maxDD, (closes[i] - peak) / peak);
  }
  if (maxDD < -0.25) { score -= 35; reasons.push(`回撤${(maxDD * 100).toFixed(0)}%>25%嚴重`); }
  else if (maxDD < -0.15) { score -= 20; reasons.push(`回撤${(maxDD * 100).toFixed(0)}%`); }
  else if (maxDD < -0.08) { score -= 8; reasons.push(`回撤${(maxDD * 100).toFixed(0)}%可接受`); }
  else { score += 5; reasons.push(`回撤僅${(maxDD * 100).toFixed(0)}%健康`); }

  // Annualized volatility
  const returns = closes.slice(-20).map((c, i, a) => i === 0 ? 0 : (c - a[i - 1]) / a[i - 1]);
  const vol = Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / returns.length) * Math.sqrt(252);
  if (vol > 0.7) { score -= 25; reasons.push(`波動率${(vol * 100).toFixed(0)}%極高`); }
  else if (vol > 0.5) { score -= 15; reasons.push(`波動率${(vol * 100).toFixed(0)}%偏高`); }
  else if (vol > 0.3) { score -= 5; }
  else { score += 5; reasons.push(`低波動${(vol * 100).toFixed(0)}%`); }

  // Chase risk: far above SMA20 is risky, but less so in strong trends (ADX high)
  const sma20 = calcSMA(closes, 20);
  if (sma20[last]) {
    const dist = (closes[last] - sma20[last]!) / sma20[last]!;
    if (dist > 0.3) { score -= 15; reasons.push("離均線>30%追高風險"); }
    else if (dist > 0.15) { score -= 5; reasons.push("略離均線"); }
    else if (dist < -0.05) { score -= 12; reasons.push("跌破SMA20"); }
    else { score += 3; }
  }

  // Position sizing
  const riskLevel = score >= 70 ? "可重倉" : score >= 50 ? "半倉" : "輕倉/觀望";
  reasons.push(`倉位: ${riskLevel}`);

  return { agent: "Risk(風控)", score: Math.max(0, Math.min(100, score)), signal: toSignal(score), reasoning: reasons.join("; ") };
}

// Orchestrator: run all 5 agents, determine consensus
// newsScore is optional 6th agent from Finnhub — included in display but doesn't block consensus
export function runMultiAgentScoring(symbol: string, data: OHLCV[], newsAgent?: AgentScore): ConsensusResult {
  if (data.length < 60) {
    return { symbol, consensus: false, avgScore: 0, agents: [], recommendation: "資料不足(需至少60根K線)" };
  }

  const coreAgents = [scoreMacro(data), scoreTechnical(data), scoreSentiment(data), scoreFundamentals(data), scoreRisk(data)];
  const agents = newsAgent ? [...coreAgents, newsAgent] : coreAgents;

  // Consensus based on core 5 only (news is supplementary)
  const coreConsensus = coreAgents.every(a => a.score >= CONSENSUS_THRESHOLD);
  const avgScore = agents.reduce((s, a) => s + a.score, 0) / agents.length;
  // News can VETO if strongly negative (< 30)
  const newsVeto = newsAgent && newsAgent.score < 30;
  const consensus = coreConsensus && !newsVeto;
  const allBuy = coreAgents.every(a => a.signal === "BUY" || a.signal === "STRONG_BUY");

  let recommendation: string;
  if (newsVeto) {
    recommendation = "🔴 新聞面強烈負面 — 暫緩進場";
  } else if (consensus && allBuy) {
    recommendation = "🟢 全員共識買入 — 符合SNDK爆發模型";
  } else if (consensus) {
    recommendation = "🟡 全員通過但信號分歧 — 持續觀察";
  } else {
    const bearish = coreAgents.filter(a => a.score < CONSENSUS_THRESHOLD);
    recommendation = `⚪ 未達共識 — ${bearish.map(a => a.agent).join(",")}未通過`;
  }

  return { symbol, consensus, avgScore, agents, recommendation };
}
