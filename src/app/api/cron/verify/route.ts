import { NextRequest, NextResponse } from "next/server";
import { runMultiAgentScoring } from "@/lib/multi-agent-scoring";
import { trySupabase } from "@/lib/supabase";
import type { OHLCV } from "@/lib/indicators";

// GET /api/cron/verify?secret=...
// Self-test: runs full pipeline on 1 symbol (NVDA) without writing.
// Returns pass/fail for each stage: data fetch, scoring, supabase connectivity.

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checks: { stage: string; pass: boolean; ms: number; detail?: string }[] = [];
  const t = () => Date.now();

  // 1. Yahoo Finance data fetch
  let data: OHLCV[] = [];
  let s = t();
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const period1 = new Date(Date.now() - 150 * 86400000).toISOString().split("T")[0];
    const result = await yf.chart("NVDA", { period1, interval: "1d" });
    data = (result.quotes || [])
      .filter(q => q.open != null && q.close != null)
      .map(q => ({ time: Math.floor(new Date(q.date).getTime() / 1000), open: q.open!, high: q.high!, low: q.low!, close: q.close!, volume: q.volume || 0 }));
    checks.push({ stage: "yahoo_fetch", pass: data.length > 50, ms: t() - s, detail: `${data.length} bars` });
  } catch (e) {
    checks.push({ stage: "yahoo_fetch", pass: false, ms: t() - s, detail: String(e) });
  }

  // 2. Multi-agent scoring
  s = t();
  try {
    if (data.length < 60) throw new Error("insufficient data");
    const result = runMultiAgentScoring("NVDA", data);
    checks.push({ stage: "scoring", pass: result.avgScore > 0, ms: t() - s, detail: `avg=${result.avgScore.toFixed(0)}, consensus=${result.consensus}` });
  } catch (e) {
    checks.push({ stage: "scoring", pass: false, ms: t() - s, detail: String(e) });
  }

  // 3. Supabase connectivity
  s = t();
  const supabase = trySupabase();
  if (supabase) {
    try {
      const { count, error } = await supabase.from("watchlists").select("*", { count: "exact", head: true });
      checks.push({ stage: "supabase", pass: !error, ms: t() - s, detail: error ? error.message : `${count} rows` });
    } catch (e) {
      checks.push({ stage: "supabase", pass: false, ms: t() - s, detail: String(e) });
    }
  } else {
    checks.push({ stage: "supabase", pass: false, ms: 0, detail: "no credentials" });
  }

  // 4. Env vars present
  const requiredEnv = ["CRON_SECRET"];
  const optionalEnv = ["DISCORD_WEBHOOK_URL", "TELEGRAM_BOT_TOKEN", "FINNHUB_API_KEY"];
  const envCheck = {
    required: requiredEnv.map(k => ({ key: k, set: !!process.env[k] })),
    optional: optionalEnv.map(k => ({ key: k, set: !!process.env[k] })),
  };
  checks.push({ stage: "env_vars", pass: requiredEnv.every(k => !!process.env[k]), ms: 0, detail: JSON.stringify(envCheck) });

  const allPass = checks.every(c => c.pass);
  return NextResponse.json({ ok: allPass, checks, ts: new Date().toISOString() }, { status: allPass ? 200 : 503 });
}
