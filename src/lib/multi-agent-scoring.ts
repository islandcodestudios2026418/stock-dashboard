// Multi-agent scoring: 5 independent analyst perspectives score each stock.
// All 5 must agree (score >= threshold) before flagging a stock as a consensus pick.

import { OHLCV, calcEMA, calcMACD, calcRSI, calcKDJ, calcBOLL, calcSMA } from "./indicators";

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

const CONSENSUS_THRESHOLD = 65; // All agents must score >= this

function toSignal(score: number): AgentScore["signal"] {
  if (score >= 80) return "STRONG_BUY";
  if (score >= 65) return "BUY";
  if (score >= 40) return "NEUTRAL";
  if (score >= 20) return "SELL";
  return "STRONG_SELL";
}

// Agent 1: Macro/Structural (interest rate cycle, sector rotation)
export function scoreMacro(data: OHLCV[]): AgentScore {
  const closes = data.map(d => d.close);
  const last = closes.length - 1;
  let score = 50;
  const reasons: string[] = [];

  // Long-term trend (EMA50 vs EMA200 — golden/death cross proxy)
  const ema50 = calcEMA(closes, Math.min(50, closes.length - 1));
  const ema200 = calcEMA(closes, Math.min(200, closes.length - 1));
  if (ema50[last] > ema200[last]) {
    score += 15;
    reasons.push("長期趨勢向上(EMA50>200)");
  } else {
    score -= 15;
    reasons.push("長期趨勢向下(EMA50<200)");
  }

  // Price above 200EMA = structural uptrend
  if (closes[last] > ema200[last]) {
    score += 10;
    reasons.push("價格在200EMA之上");
  } else {
    score -= 10;
  }

  // 6-month momentum
  const sixMonthAgo = Math.max(0, last - 126);
  const sixMonthReturn = (closes[last] - closes[sixMonthAgo]) / closes[sixMonthAgo];
  if (sixMonthReturn > 0.2) { score += 15; reasons.push(`6個月漲${(sixMonthReturn * 100).toFixed(0)}%`); }
  else if (sixMonthReturn > 0) { score += 5; }
  else { score -= 10; reasons.push(`6個月跌${(sixMonthReturn * 100).toFixed(0)}%`); }

  // Breakout from multi-month range
  const highRange = Math.max(...closes.slice(-60));
  if (closes[last] >= highRange * 0.98) {
    score += 10;
    reasons.push("接近60日新高");
  }

  return { agent: "Macro(總經)", score: Math.max(0, Math.min(100, score)), signal: toSignal(score), reasoning: reasons.join("; ") };
}

// Agent 2: Technical Analysis
export function scoreTechnical(data: OHLCV[]): AgentScore {
  const closes = data.map(d => d.close);
  const last = closes.length - 1;
  let score = 50;
  const reasons: string[] = [];

  // MACD
  const macd = calcMACD(closes);
  if (macd.dif[last] > macd.dea[last] && macd.dif[last - 1] <= macd.dea[last - 1]) {
    score += 15; reasons.push("MACD金叉");
  } else if (macd.dif[last] > macd.dea[last]) {
    score += 5; reasons.push("MACD多頭");
  } else if (macd.dif[last] < macd.dea[last] && macd.dif[last - 1] >= macd.dea[last - 1]) {
    score -= 15; reasons.push("MACD死叉");
  } else {
    score -= 5;
  }

  // RSI
  const rsi = calcRSI(closes);
  const rsiVal = rsi[last] ?? 50;
  if (rsiVal > 50 && rsiVal < 70) { score += 10; reasons.push(`RSI=${rsiVal.toFixed(0)}健康多頭`); }
  else if (rsiVal >= 70) { score -= 5; reasons.push("RSI超買"); }
  else if (rsiVal < 30) { score += 5; reasons.push("RSI超賣反彈機會"); }
  else { score -= 5; }

  // KDJ
  const kdj = calcKDJ(data);
  if (kdj.k[last] > kdj.d[last] && kdj.k[last - 1] <= kdj.d[last - 1]) {
    score += 10; reasons.push("KDJ金叉");
  }

  // Bollinger position
  const boll = calcBOLL(closes);
  const mid = boll.mid[last];
  const upper = boll.upper[last];
  if (mid && upper && closes[last] > mid && closes[last] < upper) {
    score += 5; reasons.push("價格在布林中上軌間");
  }

  // Volume confirmation
  const avgVol = data.slice(-20).reduce((s, d) => s + d.volume, 0) / 20;
  if (data[last].volume > avgVol * 1.5 && closes[last] > closes[last - 1]) {
    score += 10; reasons.push("放量上漲");
  }

  return { agent: "Technical(技術)", score: Math.max(0, Math.min(100, score)), signal: toSignal(score), reasoning: reasons.join("; ") };
}

// Agent 3: Sentiment/News (approximated from price action patterns)
export function scoreSentiment(data: OHLCV[]): AgentScore {
  const closes = data.map(d => d.close);
  const last = closes.length - 1;
  let score = 50;
  const reasons: string[] = [];

  // Gap ups (institutional interest signal)
  const gaps = data.slice(-10).filter((d, i, arr) => i > 0 && d.open > arr[i - 1].close * 1.01);
  if (gaps.length >= 2) { score += 15; reasons.push(`近10日${gaps.length}次跳空高開`); }
  else if (gaps.length === 1) { score += 5; reasons.push("近期有跳空高開"); }

  // Consecutive up days (momentum/sentiment)
  let upDays = 0;
  for (let i = last; i > last - 5 && i > 0; i--) {
    if (closes[i] > closes[i - 1]) upDays++; else break;
  }
  if (upDays >= 4) { score += 10; reasons.push(`連漲${upDays}日`); }
  else if (upDays >= 2) { score += 5; }

  // Volume surge (institutional accumulation)
  const avgVol = data.slice(-20).reduce((s, d) => s + d.volume, 0) / 20;
  const recentAvgVol = data.slice(-5).reduce((s, d) => s + d.volume, 0) / 5;
  if (recentAvgVol > avgVol * 2) {
    score += 15; reasons.push("近5日成交量倍增(疑似主力進場)");
  } else if (recentAvgVol > avgVol * 1.3) {
    score += 5; reasons.push("近期成交量放大");
  }

  // Wide range candles with close near high (buying pressure)
  const recent = data.slice(-5);
  const bullishCandles = recent.filter(d => (d.close - d.low) / (d.high - d.low + 0.001) > 0.7);
  if (bullishCandles.length >= 3) {
    score += 10; reasons.push("多根強勢K線(收在高點)");
  }

  return { agent: "Sentiment(消息)", score: Math.max(0, Math.min(100, score)), signal: toSignal(score), reasoning: reasons.join("; ") };
}

// Agent 4: Fundamentals (approximated from price patterns — P/E, growth need real API)
export function scoreFundamentals(data: OHLCV[]): AgentScore {
  const closes = data.map(d => d.close);
  const last = closes.length - 1;
  let score = 50;
  const reasons: string[] = [];

  // Steady uptrend with low volatility = quality company
  const returns = closes.slice(-60).map((c, i, a) => i === 0 ? 0 : (c - a[i - 1]) / a[i - 1]);
  const vol = Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / returns.length);
  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;

  if (avgReturn > 0 && vol < 0.03) { score += 15; reasons.push("穩定上漲低波動(優質基本面)"); }
  else if (avgReturn > 0) { score += 5; reasons.push("正報酬"); }
  else { score -= 10; reasons.push("負報酬趨勢"); }

  // New highs frequency (strong earnings likely)
  const highs = closes.slice(-60);
  let newHighCount = 0;
  for (let i = 1; i < highs.length; i++) {
    if (highs[i] >= Math.max(...highs.slice(0, i))) newHighCount++;
  }
  if (newHighCount >= 5) { score += 15; reasons.push(`60日內${newHighCount}次創新高`); }
  else if (newHighCount >= 2) { score += 5; }

  // Price acceleration (revenue acceleration proxy)
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, Math.min(50, closes.length - 1));
  const spread = ema20[last] - ema50[last];
  const prevSpread = ema20[last - 10] - ema50[last - 10];
  if (spread > prevSpread && spread > 0) {
    score += 10; reasons.push("均線差距擴大(成長加速)");
  }

  return { agent: "Fundamentals(基本面)", score: Math.max(0, Math.min(100, score)), signal: toSignal(score), reasoning: reasons.join("; ") };
}

// Agent 5: Risk Manager
export function scoreRisk(data: OHLCV[]): AgentScore {
  const closes = data.map(d => d.close);
  const last = closes.length - 1;
  let score = 70; // Start higher — subtract for risk factors
  const reasons: string[] = [];

  // Max drawdown in last 60 days
  const high60 = Math.max(...closes.slice(-60));
  const drawdown = (high60 - closes[last]) / high60;
  if (drawdown > 0.2) { score -= 30; reasons.push(`回撤${(drawdown * 100).toFixed(0)}%>20%`); }
  else if (drawdown > 0.1) { score -= 15; reasons.push(`回撤${(drawdown * 100).toFixed(0)}%`); }
  else { reasons.push(`回撤僅${(drawdown * 100).toFixed(0)}%可控`); }

  // Volatility
  const returns = closes.slice(-20).map((c, i, a) => i === 0 ? 0 : (c - a[i - 1]) / a[i - 1]);
  const vol = Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / returns.length) * Math.sqrt(252);
  if (vol > 0.6) { score -= 20; reasons.push(`年化波動率${(vol * 100).toFixed(0)}%過高`); }
  else if (vol > 0.4) { score -= 10; reasons.push(`年化波動率${(vol * 100).toFixed(0)}%偏高`); }
  else { score += 5; reasons.push(`波動率${(vol * 100).toFixed(0)}%正常`); }

  // Stop loss distance (current price vs SMA20)
  const sma20 = calcSMA(closes, 20);
  if (sma20[last]) {
    const dist = (closes[last] - sma20[last]!) / sma20[last]!;
    if (dist > 0.15) { score -= 10; reasons.push("離均線過遠追高風險"); }
    else if (dist < -0.05) { score -= 10; reasons.push("跌破均線"); }
  }

  // Position sizing recommendation based on risk
  const riskLevel = score >= 65 ? "可重倉" : score >= 40 ? "半倉" : "觀望";
  reasons.push(`建議倉位: ${riskLevel}`);

  return { agent: "Risk(風控)", score: Math.max(0, Math.min(100, score)), signal: toSignal(score), reasoning: reasons.join("; ") };
}

// Orchestrator: run all 5 agents, determine consensus
export function runMultiAgentScoring(symbol: string, data: OHLCV[]): ConsensusResult {
  if (data.length < 60) {
    return {
      symbol,
      consensus: false,
      avgScore: 0,
      agents: [],
      recommendation: "資料不足(需至少60根K線)",
    };
  }

  const agents = [
    scoreMacro(data),
    scoreTechnical(data),
    scoreSentiment(data),
    scoreFundamentals(data),
    scoreRisk(data),
  ];

  const avgScore = agents.reduce((s, a) => s + a.score, 0) / agents.length;
  const consensus = agents.every(a => a.score >= CONSENSUS_THRESHOLD);
  const allBuy = agents.every(a => a.signal === "BUY" || a.signal === "STRONG_BUY");

  let recommendation: string;
  if (consensus && allBuy) {
    recommendation = "🟢 全員共識買入 — 符合SNDK模型條件";
  } else if (consensus) {
    recommendation = "🟡 全員通過但非全部看多 — 持續觀察";
  } else {
    const bearish = agents.filter(a => a.score < CONSENSUS_THRESHOLD);
    recommendation = `⚪ 未達共識 — ${bearish.map(a => a.agent).join(",")}未通過`;
  }

  return { symbol, consensus, avgScore, agents, recommendation };
}
