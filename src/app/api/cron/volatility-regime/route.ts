import { NextRequest, NextResponse } from "next/server";

// GET /api/cron/volatility-regime — classify market as Low/Normal/High vol
// Uses VIX level + SPY realized vol to determine regime, then suggests strategy adjustments.

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

type Regime = "LOW" | "NORMAL" | "HIGH" | "EXTREME";

function classifyVix(vix: number): Regime {
  if (vix < 14) return "LOW";
  if (vix < 20) return "NORMAL";
  if (vix < 30) return "HIGH";
  return "EXTREME";
}

function strategyAdvice(regime: Regime): string {
  switch (regime) {
    case "LOW": return "🟢 Low vol: full position sizing, tight stops OK, breakout plays work well";
    case "NORMAL": return "🟡 Normal vol: standard sizing, keep current strategy";
    case "HIGH": return "🟠 High vol: reduce position size 50%, widen stops, avoid overnight holds";
    case "EXTREME": return "🔴 Extreme vol: minimal positions, cash is king, wait for vol crush before entering";
  }
}

async function fetchVIX(): Promise<{ vix: number; prevVix: number; change: number } | null> {
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const q = await yf.quote("^VIX");
    return {
      vix: q.regularMarketPrice ?? 0,
      prevVix: q.regularMarketPreviousClose ?? 0,
      change: q.regularMarketChangePercent ?? 0,
    };
  } catch { return null; }
}

async function fetchRealizedVol(symbol: string, days: number): Promise<number> {
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const period1 = new Date(Date.now() - (days + 10) * 86400000).toISOString().split("T")[0];
    const result = await yf.chart(symbol, { period1, interval: "1d" });
    const closes = (result.quotes || []).filter(q => q.close != null).map(q => q.close!);
    if (closes.length < days) return 0;
    const returns = closes.slice(-(days + 1)).slice(1).map((c, i) => Math.log(c / closes[closes.length - days - 1 + i]));
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance * 252) * 100; // annualized %
  } catch { return 0; }
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const vixData = await fetchVIX();
  const realizedVol20 = await fetchRealizedVol("SPY", 20);
  const realizedVol5 = await fetchRealizedVol("SPY", 5);

  const vix = vixData?.vix ?? 0;
  const regime = classifyVix(vix);
  const advice = strategyAdvice(regime);

  // Vol expansion check: short-term vol rising faster than long-term
  const volExpanding = realizedVol5 > realizedVol20 * 1.3;
  // Vol contraction: short-term vol compressing (potential breakout setup)
  const volContracting = realizedVol5 < realizedVol20 * 0.7;

  // Position size multiplier based on regime
  const sizeMultiplier = regime === "LOW" ? 1.0 : regime === "NORMAL" ? 1.0 : regime === "HIGH" ? 0.5 : 0.25;

  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    vix: vix ? +vix.toFixed(2) : null,
    vixChange: vixData ? `${vixData.change > 0 ? "+" : ""}${vixData.change.toFixed(1)}%` : null,
    regime,
    realizedVol: { "5d": +realizedVol5.toFixed(1), "20d": +realizedVol20.toFixed(1) },
    volExpanding,
    volContracting,
    sizeMultiplier,
    advice,
    signal: volContracting ? "🎯 Vol compression — watch for breakout" : volExpanding ? "⚡ Vol expanding — reduce risk" : "📊 Normal vol dynamics",
  });
}
