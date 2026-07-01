import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/convergence — THE highest-confidence buy signal
// Fires when multiple independent signal sources all agree on the same stock:
// - Options flow: bullish (SMART_MONEY_CALL or BULLISH_FLOW)
// - Institutional: accumulation signal (SPRING, BREAKOUT, NARROW_RANGE, etc.)
// - Supply-demand: SNDK pattern score >= 40
// - Signal composite: score >= 60 + actionable
// - Structural shift: shift score >= 50 (optional, +bonus)
//
// When ALL agree = CONVERGENCE = maximum conviction

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

interface ConvergenceSignal {
  symbol: string;
  convergenceScore: number; // 0-100
  layers: {
    optionsFlow: { active: boolean; signal?: string; strength?: number };
    institutional: { active: boolean; signal?: string; phase?: string; confidence?: number };
    supplyDemand: { active: boolean; score?: number; phase?: string };
    composite: { active: boolean; score?: number; actionable?: boolean };
    structuralShift: { active: boolean; shiftScore?: number };
  };
  layerCount: number; // how many layers agree (3-5)
  urgency: "CRITICAL" | "HIGH" | "MODERATE" | "LOW";
  reasoning: string;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const baseUrl = process.env.ZEABUR_URL || `http://localhost:${process.env.PORT || 3000}`;
  const supabase = trySupabase();

  // Get watchlist symbols
  let symbols: string[] = [];
  if (supabase) {
    const { data } = await supabase.from("watchlists").select("symbol").eq("active", true);
    symbols = (data || []).map((r: { symbol: string }) => r.symbol);
  }
  if (symbols.length === 0) symbols = (process.env.WATCHLIST || "NASDAQ:NVDA").split(",");

  const rawSymbols = symbols.map(s => s.includes(":") ? s.split(":")[1] : s);

  // Fetch all signal sources in parallel
  const [optionsRes, instRes, sdRes, compositeRes, shiftRes] = await Promise.all([
    fetch(`${baseUrl}/api/cron/options-flow?secret=${CRON_SECRET}`).then(r => r.json()).catch(() => ({})),
    fetch(`${baseUrl}/api/cron/institutional-tracker?secret=${CRON_SECRET}`).then(r => r.json()).catch(() => ({})),
    fetch(`${baseUrl}/api/cron/supply-demand?secret=${CRON_SECRET}`).then(r => r.json()).catch(() => ({})),
    fetch(`${baseUrl}/api/cron/signal-composite?secret=${CRON_SECRET}`).then(r => r.json()).catch(() => ({})),
    fetch(`${baseUrl}/api/cron/structural-shift?secret=${CRON_SECRET}`).then(r => r.json()).catch(() => ({})),
  ]);

  // Index by symbol
  type OptFlow = { symbol: string; signal: string; strength: number };
  type InstData = { symbol: string; signal: string; phase: string; confidence: number };
  type SDData = { symbol: string; score: number; phase: string };
  type CompData = { symbol: string; compositeScore: number; actionable: boolean };
  type ShiftData = { symbol: string; shiftScore: number };

  const optionsMap = new Map<string, OptFlow>(
    ((optionsRes.all || []) as OptFlow[]).map(o => [o.symbol, o])
  );
  const instMap = new Map<string, InstData>(
    ((instRes.all || []) as InstData[]).map(i => [i.symbol, i])
  );
  const sdMap = new Map<string, SDData>(
    ((sdRes.all || []) as SDData[]).map(s => [s.symbol, s])
  );
  const compositeMap = new Map<string, CompData>(
    ((compositeRes.rankings || []) as CompData[]).map(c => [c.symbol.includes(":") ? c.symbol.split(":")[1] : c.symbol, c])
  );
  const shiftMap = new Map<string, ShiftData>(
    ((shiftRes.signals || []) as ShiftData[]).map(s => [s.symbol, s])
  );

  // Check convergence for each symbol
  const results: ConvergenceSignal[] = [];

  for (const sym of rawSymbols) {
    const optEntry = optionsMap.get(sym);
    const instEntry = instMap.get(sym);
    const sdEntry = sdMap.get(sym);
    const compEntry = compositeMap.get(sym);
    const shiftEntry = shiftMap.get(sym);

    // Check each layer
    const optionsBullish = optEntry && (optEntry.signal === "SMART_MONEY_CALL" || optEntry.signal === "BULLISH_FLOW") && optEntry.strength >= 50;
    const instAccumulating = instEntry && instEntry.signal !== "NONE" && instEntry.phase !== "DISTRIBUTION" && instEntry.phase !== "MARKDOWN" && instEntry.confidence >= 60;
    const sdPattern = sdEntry && sdEntry.score >= 40;
    const compositeStrong = compEntry && compEntry.compositeScore >= 60 && compEntry.actionable;
    const structuralShift = shiftEntry && shiftEntry.shiftScore >= 50;

    const layers = {
      optionsFlow: { active: !!optionsBullish, signal: optEntry?.signal, strength: optEntry?.strength },
      institutional: { active: !!instAccumulating, signal: instEntry?.signal, phase: instEntry?.phase, confidence: instEntry?.confidence },
      supplyDemand: { active: !!sdPattern, score: sdEntry?.score, phase: sdEntry?.phase },
      composite: { active: !!compositeStrong, score: compEntry?.compositeScore, actionable: compEntry?.actionable },
      structuralShift: { active: !!structuralShift, shiftScore: shiftEntry?.shiftScore },
    };

    const layerCount = [optionsBullish, instAccumulating, sdPattern, compositeStrong, structuralShift].filter(Boolean).length;

    if (layerCount < 3) continue; // Need at least 3 layers agreeing

    // Convergence score: weighted sum of layer strengths
    let convergenceScore = 0;
    if (optionsBullish) convergenceScore += (optEntry!.strength / 100) * 20;
    if (instAccumulating) convergenceScore += (instEntry!.confidence / 100) * 20;
    if (sdPattern) convergenceScore += (sdEntry!.score / 100) * 25;
    if (compositeStrong) convergenceScore += (compEntry!.compositeScore / 100) * 20;
    if (structuralShift) convergenceScore += (shiftEntry!.shiftScore / 100) * 15;

    // Bonus for more layers
    convergenceScore += (layerCount - 3) * 5;
    convergenceScore = Math.min(100, Math.round(convergenceScore));

    const urgency: ConvergenceSignal["urgency"] =
      layerCount >= 5 ? "CRITICAL" :
      layerCount >= 4 && convergenceScore >= 70 ? "CRITICAL" :
      layerCount >= 4 ? "HIGH" :
      convergenceScore >= 60 ? "HIGH" : "MODERATE";

    const activeLayers: string[] = [];
    if (optionsBullish) activeLayers.push(`options(${optEntry!.signal})`);
    if (instAccumulating) activeLayers.push(`institutional(${instEntry!.signal})`);
    if (sdPattern) activeLayers.push(`supply-demand(${sdEntry!.score}/100)`);
    if (compositeStrong) activeLayers.push(`composite(${compEntry!.compositeScore})`);
    if (structuralShift) activeLayers.push(`shift(${shiftEntry!.shiftScore})`);

    const reasoning = `${layerCount}/5 layers converge: ${activeLayers.join(" + ")}`;

    results.push({ symbol: sym, convergenceScore, layers, layerCount, urgency, reasoning });
  }

  results.sort((a, b) => b.convergenceScore - a.convergenceScore);

  // Send URGENT alert for CRITICAL convergence
  const critical = results.filter(r => r.urgency === "CRITICAL");
  if (critical.length > 0) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (token && chatId) {
      const alertLines = critical.map(c =>
        `⚡ <b>${c.symbol}</b> — ${c.convergenceScore}/100 (${c.layerCount}/5 layers)\n   ${c.reasoning}`
      );
      const msg = `🔥🔥🔥 <b>CONVERGENCE ALERT</b> 🔥🔥🔥\n\nMultiple signal sources AGREE:\n\n${alertLines.join("\n\n")}\n\n⚡ This is the highest-confidence signal. Review immediately.`;
      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "HTML" }),
        });
      } catch { /* non-critical */ }
    }
  }

  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    scanned: rawSymbols.length,
    convergenceCount: results.length,
    critical: critical.length,
    signals: results,
    summary: results.length > 0
      ? `🔥 CONVERGENCE: ${results.map(r => `${r.symbol}(${r.layerCount}/5, ${r.convergenceScore}%)`).join(", ")}`
      : "⚪ No convergence detected — signals not yet aligned",
    methodology: "Requires 3+ of 5 independent layers (options, institutional, supply-demand, composite, structural-shift) to agree bullish on same stock.",
  });
}
