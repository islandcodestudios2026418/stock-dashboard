import { NextRequest, NextResponse } from "next/server";
import { getIndicatorSummary, calcRiskScore, type OHLCV } from "@/lib/indicators";
import { runMultiAgentScoring } from "@/lib/multi-agent-scoring";
import { orchestrate } from "@/lib/orchestrator";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/integration-test — exercises full pipeline with real data, no side effects
// Tests: Yahoo fetch → indicators → scoring → orchestrate (mock) → Supabase read
const CRON_SECRET = process.env.CRON_SECRET || "";
const TEST_SYMBOL = "AAPL"; // always available, high liquidity

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

interface TestResult { stage: string; pass: boolean; ms: number; detail?: string }

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const results: TestResult[] = [];

  // Stage 1: Yahoo Finance fetch
  let periods: OHLCV[] = [];
  const t1 = Date.now();
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const period1 = new Date(Date.now() - 60 * 86400000).toISOString().split("T")[0];
    const result = await yf.chart(TEST_SYMBOL, { period1, interval: "1d" });
    periods = (result.quotes || [])
      .filter(q => q.open != null && q.close != null)
      .map(q => ({ time: Math.floor(new Date(q.date).getTime() / 1000), open: q.open!, high: q.high!, low: q.low!, close: q.close!, volume: q.volume || 0 }));
    results.push({ stage: "yahoo-fetch", pass: periods.length >= 20, ms: Date.now() - t1, detail: `${periods.length} bars` });
  } catch (e) {
    results.push({ stage: "yahoo-fetch", pass: false, ms: Date.now() - t1, detail: String(e) });
  }

  // Stage 2: Indicators
  const t2 = Date.now();
  try {
    if (periods.length < 20) throw new Error("insufficient data");
    const ind = getIndicatorSummary(periods);
    const risk = calcRiskScore(periods);
    results.push({ stage: "indicators", pass: true, ms: Date.now() - t2, detail: `RSI=${ind.rsi.value.toFixed(1)}, risk=${risk}` });
  } catch (e) {
    results.push({ stage: "indicators", pass: false, ms: Date.now() - t2, detail: String(e) });
  }

  // Stage 3: Multi-agent scoring
  const t3 = Date.now();
  try {
    if (periods.length < 20) throw new Error("insufficient data");
    const scoring = runMultiAgentScoring(TEST_SYMBOL, periods);
    results.push({ stage: "scoring", pass: scoring.avgScore > 0, ms: Date.now() - t3, detail: `avg=${scoring.avgScore.toFixed(0)}, consensus=${scoring.consensus}` });
  } catch (e) {
    results.push({ stage: "scoring", pass: false, ms: Date.now() - t3, detail: String(e) });
  }

  // Stage 4: Orchestrator (mock LLM)
  const t4 = Date.now();
  try {
    const mockLLM = async () => JSON.stringify({ score: 55, signal: "NEUTRAL", reasoning: "integration test", conviction: 5 });
    const result = await orchestrate(TEST_SYMBOL, "test context data", mockLLM);
    results.push({ stage: "orchestrate-mock", pass: result.rounds.length > 0, ms: Date.now() - t4, detail: `${result.rounds.length} rounds, score=${result.finalScore.toFixed(0)}` });
  } catch (e) {
    results.push({ stage: "orchestrate-mock", pass: false, ms: Date.now() - t4, detail: String(e) });
  }

  // Stage 5: Supabase read
  const t5 = Date.now();
  try {
    const supabase = trySupabase();
    if (!supabase) throw new Error("not configured");
    const { error } = await supabase.from("analysis_runs").select("date").limit(1);
    results.push({ stage: "supabase-read", pass: !error, ms: Date.now() - t5, detail: error ? error.message : "ok" });
  } catch (e) {
    results.push({ stage: "supabase-read", pass: false, ms: Date.now() - t5, detail: String(e) });
  }

  const allPass = results.every(r => r.pass);
  const totalMs = results.reduce((s, r) => s + r.ms, 0);

  return NextResponse.json({ allPass, totalMs, results }, { status: allPass ? 200 : 503 });
}
