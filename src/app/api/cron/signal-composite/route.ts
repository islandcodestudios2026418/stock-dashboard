import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/signal-composite — unified scoring combining all signals into one ranked list
// Weights: base score (35%) + multi-TF alignment (15%) + RS (10%) + structural shift (10%) + vol regime (10%) + options flow (10%) + institutional (10%)
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

  // Fetch all signals in parallel
  const [mtfRes, volRes, optionsRes, instRes] = await Promise.all([
    fetch(`${baseUrl}/api/cron/multi-timeframe?secret=${CRON_SECRET}`).then(r => r.json()).catch(() => ({})),
    fetch(`${baseUrl}/api/cron/volatility-regime?secret=${CRON_SECRET}`).then(r => r.json()).catch(() => ({})),
    fetch(`${baseUrl}/api/cron/options-flow?secret=${CRON_SECRET}`).then(r => r.json()).catch(() => ({})),
    fetch(`${baseUrl}/api/cron/institutional-tracker?secret=${CRON_SECRET}`).then(r => r.json()).catch(() => ({})),
  ]);

  const mtfData = mtfRes as { results?: { symbol: string; actionable: boolean; daily: { trend: string }; weekly: { trend: string }; monthly: { trend: string } }[] };
  const volRegime = volRes as { regime?: string; sizeMultiplier?: number };
  const optionsData = optionsRes as { all?: { symbol: string; signal: string; strength: number }[] };
  const instData = instRes as { all?: { symbol: string; signal: string; phase: string; confidence: number }[] };

  // Index options + institutional by symbol
  const optionsMap = new Map((optionsData.all || []).map(o => [o.symbol, o]));
  const instMap = new Map((instData.all || []).map(i => [i.symbol, i]));

  // Build composite scores
  const composites: {
    symbol: string; compositeScore: number; rank: number;
    components: { base: number; mtf: number; rs: number; conviction: number; volAdj: number; options: number; institutional: number };
    flags: string[]; actionable: boolean;
  }[] = [];

  for (const a of analyses) {
    const symbol = a.symbol;
    const raw = symbol.includes(":") ? symbol.split(":")[1] : symbol;
    const baseScore = a.scoring?.avgScore || 0;

    // Multi-TF component: +15 if all aligned, +8 if daily+weekly agree, 0 if mixed, -8 if against
    const mtfEntry = (mtfData.results || []).find(m => m.symbol === raw);
    let mtfScore = 0;
    if (mtfEntry) {
      if (mtfEntry.actionable && mtfEntry.weekly.trend === "BULLISH" && mtfEntry.monthly.trend === "BULLISH") mtfScore = 15;
      else if (mtfEntry.actionable) mtfScore = 8;
      else if (mtfEntry.daily.trend === "BEARISH") mtfScore = -8;
    }

    // RS component: scale RS vs SPY to 0-10 range
    const rsVsSpy = a.scoring?.rsVsSpy ?? 0;
    const rsScore = Math.max(0, Math.min(10, rsVsSpy / 3 + 5));

    // Conviction component: streak bonus (0-10)
    const streak = a.scoring?.conviction?.streak ?? 0;
    const convictionScore = Math.min(10, streak * 2.5);

    // Vol adjustment: penalize in high vol, bonus in low vol
    const volAdj = volRegime.regime === "LOW" ? 5 : volRegime.regime === "HIGH" ? -8 : volRegime.regime === "EXTREME" ? -15 : 0;

    // Options flow component: bullish = +8, smart money = +10, bearish = -8
    const optionsEntry = optionsMap.get(raw);
    let optionsScore = 0;
    if (optionsEntry) {
      if (optionsEntry.signal === "SMART_MONEY_CALL") optionsScore = 10;
      else if (optionsEntry.signal === "BULLISH_FLOW") optionsScore = 8;
      else if (optionsEntry.signal === "UNUSUAL_ACTIVITY" && optionsEntry.strength > 60) optionsScore = 5;
      else if (optionsEntry.signal === "BEARISH_FLOW") optionsScore = -8;
      else if (optionsEntry.signal === "PROTECTIVE_PUTS") optionsScore = -6;
    }

    // Institutional component: accumulation signal = +10, spring = +12, distribution phase = -8
    const instEntry = instMap.get(raw);
    let instScore = 0;
    if (instEntry) {
      if (instEntry.signal === "SPRING") instScore = 12;
      else if (instEntry.signal === "BREAKOUT_ON_VOLUME") instScore = 10;
      else if (instEntry.signal === "NARROW_RANGE_ABSORPTION") instScore = 8;
      else if (instEntry.signal === "VOLUME_DRYUP") instScore = 7;
      else if (instEntry.signal === "SHAKEOUT_REVERSAL") instScore = 8;
      else if (instEntry.phase === "ACCUMULATION") instScore = 4;
      else if (instEntry.phase === "DISTRIBUTION") instScore = -8;
      else if (instEntry.phase === "MARKDOWN") instScore = -10;
    }

    // Composite = weighted sum, normalized to 0-100
    // base(35%) + mtf(15%) + rs(10%) + conviction(10%) + vol(10%) + options(10%) + inst(10%)
    const composite = Math.max(0, Math.min(100,
      baseScore * 0.4 + mtfScore * 1.0 + rsScore * 1.0 + convictionScore * 1.0 + volAdj * 0.5 + optionsScore * 1.0 + instScore * 1.0
    ));

    const flags: string[] = [];
    if (a.scoring?.consensus) flags.push("🎯 CONSENSUS");
    if (mtfEntry?.actionable && mtfEntry.monthly.trend === "BULLISH") flags.push("📈 MTF aligned");
    if (rsVsSpy > 10) flags.push("💪 Strong RS");
    if (streak >= 5) flags.push("🔥 Streak");
    if (volRegime.regime === "HIGH" || volRegime.regime === "EXTREME") flags.push("⚠️ High vol");
    if (optionsEntry?.signal === "SMART_MONEY_CALL" || optionsEntry?.signal === "BULLISH_FLOW") flags.push("📞 Bullish flow");
    if (optionsEntry?.signal === "BEARISH_FLOW" || optionsEntry?.signal === "PROTECTIVE_PUTS") flags.push("📉 Bearish flow");
    if (instEntry?.signal && instEntry.signal !== "NONE" && instEntry.phase !== "DISTRIBUTION") flags.push("🏦 Institutional");
    if (instEntry?.phase === "DISTRIBUTION") flags.push("🚨 Distribution");

    const actionable = composite >= 60 && (mtfEntry?.actionable ?? true) && volRegime.regime !== "EXTREME" && instEntry?.phase !== "DISTRIBUTION";

    composites.push({
      symbol, compositeScore: +composite.toFixed(1), rank: 0,
      components: { base: +baseScore.toFixed(0), mtf: mtfScore, rs: +rsScore.toFixed(1), conviction: +convictionScore.toFixed(1), volAdj, options: optionsScore, institutional: instScore },
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
