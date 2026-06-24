// Finnhub News Sentiment Agent — real news data for scoring
// Free tier: 60 calls/min, company news endpoint
// Scores headlines using keyword matching (no LLM needed)

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";

interface FinnhubNews {
  datetime: number;
  headline: string;
  summary: string;
  source: string;
  category: string;
}

export interface NewsSentimentResult {
  score: number; // 0-100
  signal: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
  reasoning: string;
  newsCount: number;
  avgSentiment: number; // -1 to +1
}

// Bullish/bearish keyword dictionaries (weighted)
const BULLISH: [RegExp, number][] = [
  [/\b(beat|beats|beating|exceeded|surpass)\b/i, 2],
  [/\b(upgrade|upgrades|upgraded)\b/i, 2],
  [/\b(breakout|all.time high|new high|record)\b/i, 1.5],
  [/\b(buy|outperform|overweight|strong buy)\b/i, 2],
  [/\b(growth|revenue growth|profit growth)\b/i, 1],
  [/\b(deal|partnership|contract|award)\b/i, 1.5],
  [/\b(AI|artificial intelligence|data center)\b/i, 1],
  [/\b(dividend|buyback|repurchase)\b/i, 1],
  [/\b(insider buy|insider purchase)\b/i, 2],
  [/\b(rally|surge|soar|jump|pop)\b/i, 1],
  [/\b(bull|bullish)\b/i, 1.5],
  [/\b(supply shortage|supply constraint|undersupply)\b/i, 2],
];

const BEARISH: [RegExp, number][] = [
  [/\b(miss|misses|missed|below expectations)\b/i, 2],
  [/\b(downgrade|downgrades|downgraded)\b/i, 2],
  [/\b(sell|underperform|underweight)\b/i, 2],
  [/\b(layoff|restructur|cut|firing)\b/i, 1.5],
  [/\b(lawsuit|sued|investigation|probe|SEC)\b/i, 1.5],
  [/\b(debt|default|bankruptcy)\b/i, 2],
  [/\b(insider sell|insider sale)\b/i, 1.5],
  [/\b(crash|plunge|tumble|sink|drop)\b/i, 1],
  [/\b(bear|bearish)\b/i, 1.5],
  [/\b(oversupply|demand weak|slowdown)\b/i, 1.5],
  [/\b(recall|warning|risk)\b/i, 1],
];

function scoreHeadline(text: string): number {
  let s = 0;
  for (const [re, w] of BULLISH) if (re.test(text)) s += w;
  for (const [re, w] of BEARISH) if (re.test(text)) s -= w;
  return Math.max(-1, Math.min(1, s / 3)); // normalize to [-1, 1]
}

export async function fetchFinnhubNews(symbol: string, days = 7): Promise<FinnhubNews[]> {
  if (!FINNHUB_KEY) return [];
  const to = new Date().toISOString().split("T")[0];
  const from = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
  // Strip exchange prefix (NASDAQ:NVDA -> NVDA)
  const ticker = symbol.includes(":") ? symbol.split(":")[1] : symbol;

  const url = `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${from}&to=${to}&token=${FINNHUB_KEY}`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) return [];
  return res.json();
}

export async function scoreNewsSentiment(symbol: string): Promise<NewsSentimentResult> {
  const news = await fetchFinnhubNews(symbol, 7);

  if (news.length === 0) {
    return { score: 50, signal: "NEUTRAL", reasoning: FINNHUB_KEY ? "無近期新聞" : "未設定FINNHUB_API_KEY", newsCount: 0, avgSentiment: 0 };
  }

  // Score each headline+summary
  const sentiments = news.map(n => scoreHeadline(`${n.headline} ${n.summary}`));
  const avg = sentiments.reduce((s, v) => s + v, 0) / sentiments.length;
  const positiveCount = sentiments.filter(s => s > 0.1).length;
  const negativeCount = sentiments.filter(s => s < -0.1).length;

  // Convert to 0-100 score
  let score = 50; // neutral base
  score += avg * 25; // sentiment direction: max ±25
  // News volume bonus: lots of positive news = institutional attention
  if (news.length >= 10 && avg > 0.2) score += 10;
  else if (news.length >= 5 && avg > 0.1) score += 5;
  // Analyst action detection (upgrades/downgrades weigh heavily)
  const upgrades = news.filter(n => /upgrade/i.test(n.headline)).length;
  const downgrades = news.filter(n => /downgrade/i.test(n.headline)).length;
  score += (upgrades - downgrades) * 5;

  score = Math.max(0, Math.min(100, score));

  const reasons: string[] = [];
  reasons.push(`${news.length}則新聞(7天)`);
  if (positiveCount > negativeCount * 2) reasons.push(`正面${positiveCount}:負面${negativeCount}`);
  else if (negativeCount > positiveCount * 2) reasons.push(`負面${negativeCount}:正面${positiveCount}`);
  if (upgrades) reasons.push(`${upgrades}次升評`);
  if (downgrades) reasons.push(`${downgrades}次降評`);
  if (avg > 0.3) reasons.push("情緒強烈正面");
  else if (avg < -0.3) reasons.push("情緒強烈負面");

  const signal = score >= 80 ? "STRONG_BUY" : score >= 65 ? "BUY" : score >= 40 ? "NEUTRAL" : score >= 20 ? "SELL" : "STRONG_SELL";
  return { score, signal, reasoning: reasons.join("; "), newsCount: news.length, avgSentiment: avg };
}
