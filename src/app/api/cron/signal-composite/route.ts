import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/signal-composite — unified scoring combining all signals into one ranked list
// Weights: base score (40%) + multi-TF alignment (20%) + RS (15%) + structural shift (15%) + vol regime (10%)
// This is the "one number" that determines which stock to buy RIGHT NOW.

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = trySupabase();
  const baseUrl = process.env.ZEABUR_URL || `http://localhost:${process.env.PORT || 3000}`;
  const today = new Date().toISOString().split("T")[0];

  // Fetch base scores from today's analysis
  let analyses: { symbol: string; scoring?: { avgScore?: number; consensus?: boolean; rsVsSpy?: number; conviction?: { convictionScore?: number; streak?: number }; sector?: { sector?: string } } }[] = [];
  if (supabase) {
    const { data } = await supabase.from("analysis_results").select("symbol, scoring").eq("date", today);
    analyses = (data || []) as typeof analyses;
  }

  if (analyses.length === 0) {
    return NextResponse.json({ message: "No analysis data for today. Run /api/cron/trigger first.", results: [] });
  }

  // Fetch multi-timeframe data
  let mtfData: { results?: { symbol: string; actionable: boolean; daily: { trend: string }; weekly: { trend: string }; monthly: { trend: string } }[] } = {};
  try {
    const res = await fetch(`${baseUrl}/api/cron/multi-timeframe?secret=${CRON_SECRET}`);
    mtfData = await res.json();
  } catch { /* non-critical */ }

  // Fetch vol regime
  let volRegime: { regime?: string; sizeMultiplier?: number } = {};
  try {
    const res = await fetch(`${baseUrl}/api/cron/volatility-regime?secret=${CRON_SECRET}`);
    volRegime = await res.json();
  } catch { /* non-critical */ }

  // Build composite scores
  const composites: {
    symbol: string; compositeScore: number; rank: number;
    components: { base: number; mtf: number; rs: number; conviction: number; volAdj: number };
    flags: string[]; actionable: boolean;
  }[] = [];

  for (const a of analyses) {
    const symbol = a.symbol;
    const raw = symbol.includes(":") ? symbol.split(":")[1] : symbol;
    const baseScore = a.scoring?.avgScore || 0;

    // Multi-TF component: +20 if all aligned, +10 if daily+weekly agree, 0 if mixed, -10 if against
    const mtfEntry = (mtfData.results || []).find(m => m.symbol === raw);
    let mtfScore = 0;
    if (mtfEntry) {
      if (mtfEntry.actionable && mtfEntry.weekly.trend === "BULLISH" && mtfEntry.monthly.trend === "BULLISH") mtfScore = 20;
      else if (mtfEntry.actionable) mtfScore = 10;
      else if (mtfEntry.daily.trend === "BEARISH") mtfScore = -10;
    }

    // RS component: scale RS vs SPY to 0-15 range
    const rsVsSpy = a.scoring?.rsVsSpy ?? 0;
    const rsScore = Math.max(0, Math.min(15, rsVsSpy / 2 + 7.5));

    // Conviction component: streak bonus
    const streak = a.scoring?.conviction?.streak ?? 0;
    const convictionScore = Math.min(15, streak * 3);

    // Vol adjustment: penalize in high vol, bonus in low vol
    const volAdj = volRegime.regime === "LOW" ? 5 : volRegime.regime === "HIGH" ? -10 : volRegime.regime === "EXTREME" ? -20 : 0;

    // Composite = weighted sum, normalized to 0-100
    const composite = Math.max(0, Math.min(100,
      baseScore * 0.5 + mtfScore * 1.0 + rsScore * 1.0 + convictionScore * 1.0 + volAdj * 0.5
    ));

    const flags: string[] = [];
    if (a.scoring?.consensus) flags.push("🎯 CONSENSUS");
    if (mtfEntry?.actionable && mtfEntry.monthly.trend === "BULLISH") flags.push("📈 MTF aligned");
    if (rsVsSpy > 10) flags.push("💪 Strong RS");
    if (streak >= 5) flags.push("🔥 Streak");
    if (volRegime.regime === "HIGH" || volRegime.regime === "EXTREME") flags.push("⚠️ High vol");

    const actionable = composite >= 60 && (mtfEntry?.actionable ?? true) && volRegime.regime !== "EXTREME";

    composites.push({
      symbol, compositeScore: +composite.toFixed(1), rank: 0,
      components: { base: +baseScore.toFixed(0), mtf: mtfScore, rs: +rsScore.toFixed(1), conviction: convictionScore, volAdj },
      flags, actionable,
    });
  }

  // Sort and rank
  composites.sort((a, b) => b.compositeScore - a.compositeScore);
  composites.forEach((c, i) => c.rank = i + 1);

  const actionable = composites.filter(c => c.actionable);

  return NextResponse.json({
    date: today,
    volRegime: volRegime.regime || "UNKNOWN",
    totalSymbols: composites.length,
    actionableCount: actionable.length,
    rankings: composites,
    topPick: composites[0] || null,
    summary: actionable.length > 0
      ? `🎯 Top pick: ${composites[0].symbol} (${composites[0].compositeScore}/100) | ${actionable.length} actionable`
      : "⚪ No actionable signals today",
  });
}
