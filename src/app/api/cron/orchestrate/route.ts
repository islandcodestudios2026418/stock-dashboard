import { NextRequest, NextResponse } from "next/server";
import { orchestrate } from "@/lib/orchestrator";
import { getIndicatorSummary, calcRiskScore, type OHLCV } from "@/lib/indicators";
import { calcSupportResistance } from "@/lib/levels";
import { trySupabase } from "@/lib/supabase";

// POST /api/cron/orchestrate — Phase 2 LLM multi-agent debate
// Body: { symbol, provider?: "anthropic"|"openai"|"mock" }
// Requires CRON_SECRET auth + LLM API key

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { symbol, provider = "mock" } = await req.json();
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  // Fetch market data
  const yahooSymbol = symbol.includes(":") ? (symbol.startsWith("TWSE:") ? `${symbol.split(":")[1]}.TW` : symbol.split(":")[1]) : symbol;
  const mod = await import("yahoo-finance2");
  const YahooFinance = mod.default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const period1 = new Date(Date.now() - 150 * 86400000).toISOString().split("T")[0];
  const result = await yf.chart(yahooSymbol, { period1, interval: "1d" });
  const data: OHLCV[] = (result.quotes || [])
    .filter(q => q.open != null && q.close != null)
    .map(q => ({ time: Math.floor(new Date(q.date).getTime() / 1000), open: q.open!, high: q.high!, low: q.low!, close: q.close!, volume: q.volume || 0 }));

  if (data.length < 60) return NextResponse.json({ error: "insufficient data" }, { status: 400 });

  // Build context string for LLM agents
  const indicators = getIndicatorSummary(data);
  const risk = calcRiskScore(data);
  const levels = calcSupportResistance(data);
  const last = data[data.length - 1];
  const last5 = data.slice(-5);
  const pctChange30d = ((last.close - data[data.length - 31]?.close) / (data[data.length - 31]?.close || 1) * 100).toFixed(1);

  const marketContext = [
    `Symbol: ${symbol} | Price: $${last.close.toFixed(2)} | Vol: ${last.volume.toLocaleString()}`,
    `30d Change: ${pctChange30d}% | Risk: ${risk}/10`,
    `MACD: DIF=${indicators.macd.dif.toFixed(2)} DEA=${indicators.macd.dea.toFixed(2)} | RSI: ${indicators.rsi.value.toFixed(1)}`,
    `KDJ: K=${indicators.kdj.k.toFixed(1)} D=${indicators.kdj.d.toFixed(1)} | MA: ${indicators.ma.status}`,
    `Support: ${levels.filter(l => l.type === "support").slice(0, 2).map(l => l.price.toFixed(2)).join("/")}`,
    `Resistance: ${levels.filter(l => l.type === "resistance").slice(0, 2).map(l => l.price.toFixed(2)).join("/")}`,
    `Last 5 days: ${last5.map(d => `${d.close.toFixed(2)}(${d.volume > data.slice(-20).reduce((s, x) => s + x.volume, 0) / 20 ? "↑" : ""})`).join(" → ")}`,
  ].join("\n");

  // Select LLM provider
  const llm = getLLMProvider(provider);
  const orchestrationResult = await orchestrate(symbol, marketContext, llm);

  // Store result in Supabase
  const supabase = trySupabase();
  if (supabase) {
    await supabase.from("analysis_results").upsert({
      symbol, date: new Date().toISOString().split("T")[0],
      analysis: orchestrationResult.recommendation,
      scoring: { phase: 2, ...orchestrationResult },
      indicators, ts: Date.now(),
    }, { onConflict: "symbol,date" });
  }

  return NextResponse.json(orchestrationResult);
}

function getLLMProvider(provider: string) {
  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return async (system: string, user: string) => {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 512, system, messages: [{ role: "user", content: user }] }),
      });
      const data = await res.json();
      return data.content?.[0]?.text || "";
    };
  }
  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    return async (system: string, user: string) => {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 512, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      });
      const data = await res.json();
      return data.choices?.[0]?.message?.content || "";
    };
  }
  // Mock provider: uses deterministic scoring (same as Phase 1) — for testing
  return async (_system: string, user: string) => {
    const score = 50 + Math.floor(Math.random() * 35);
    const signal = score >= 80 ? "STRONG_BUY" : score >= 65 ? "BUY" : "NEUTRAL";
    return JSON.stringify({ score, signal, reasoning: `Mock analysis for ${user.slice(8, 30)}...`, conviction: Math.ceil(score / 15) });
  };
}
