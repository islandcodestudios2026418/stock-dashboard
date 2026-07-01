import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/pipeline — unified daily runner
// Calls ALL signal endpoints in parallel, combines into one comprehensive digest
// This is the "single source of truth" for the daily morning analysis

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

interface PipelineStage {
  name: string;
  path: string;
  status: "success" | "failed" | "skipped";
  durationMs: number;
  data?: unknown;
  error?: string;
}

interface DailyDigest {
  date: string;
  generatedAt: string;
  pipeline: PipelineStage[];
  digest: {
    marketConditions: {
      volRegime: string;
      breadthRegime: string;
      consensusThreshold: number;
      sizeMultiplier: number;
    };
    topPicks: { symbol: string; compositeScore: number; signals: string[]; entryPattern?: string; entryZone?: { low: number; high: number } }[];
    optionsFlow: { symbol: string; signal: string; strength: number; reasoning: string }[];
    institutionalAccumulation: { symbol: string; signal: string; phase: string; confidence: number }[];
    structuralShifts: { symbol: string; shiftScore: number; reasoning: string }[];
    supplyDemand: { symbol: string; score: number; phase: string; triggers: string[] }[];
    convergence: { symbol: string; convergenceScore: number; layerCount: number; urgency: string; reasoning: string }[];
    exitAlerts: { symbol: string; signal: string; urgency: number; detail: string }[];
    positionHealth: { totalPositions: number; atRisk: number; summary: string };
    actionItems: string[];
  };
  textSummary: string;
  pipelineDurationMs: number;
}

async function fetchStage(baseUrl: string, path: string, name: string): Promise<PipelineStage> {
  const start = Date.now();
  try {
    const url = `${baseUrl}${path}${path.includes("?") ? "&" : "?"}secret=${CRON_SECRET}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { name, path, status: "success", durationMs: Date.now() - start, data };
  } catch (e) {
    return { name, path, status: "failed", durationMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
  }
}

function buildDigest(stages: PipelineStage[]): DailyDigest["digest"] {
  const get = (name: string) => stages.find(s => s.name === name)?.data as Record<string, unknown> | undefined;

  // Market conditions from vol regime + breadth
  const volData = get("volatility-regime");
  const breadthData = get("market-breadth");
  const volRegime = (volData?.regime as string) || "UNKNOWN";
  const sizeMultiplier = (volData?.sizeMultiplier as number) || 1.0;
  const breadthRegime = (breadthData?.regime as string) || "UNKNOWN";
  const consensusThreshold = sizeMultiplier <= 0.25 ? 85 : sizeMultiplier <= 0.5 ? 75 : 65;

  // Top picks from signal composite
  const compositeData = get("signal-composite");
  const rankings = (compositeData?.rankings || []) as { symbol: string; compositeScore: number; flags: string[]; actionable: boolean }[];
  const actionableRankings = rankings.filter(r => r.actionable).slice(0, 5);

  // Entry timing enrichment
  const entryData = get("entry-timing");
  const entrySignals = (entryData?.signals || []) as { symbol: string; pattern: string; confidence: number; entryZone?: { low: number; high: number } }[];
  const entryMap = new Map(entrySignals.map(e => [e.symbol, e]));

  const topPicks = actionableRankings.map(r => {
    const entry = entryMap.get(r.symbol);
    return {
      symbol: r.symbol,
      compositeScore: r.compositeScore,
      signals: r.flags,
      entryPattern: entry?.pattern,
      entryZone: entry?.entryZone,
    };
  });

  // Options flow
  const optionsData = get("options-flow");
  const optionsSignals = ((optionsData?.signals || []) as { symbol: string; signal: string; strength: number; reasoning: string }[])
    .filter(s => s.strength >= 50).slice(0, 5);

  // Institutional tracker
  const instData = get("institutional-tracker");
  const instAccumulating = ((instData?.accumulating || []) as { symbol: string; signal: string; phase: string; confidence: number }[])
    .filter(a => a.confidence >= 60).slice(0, 5);

  // Structural shifts
  const shiftData = get("structural-shift");
  const shifts = ((shiftData?.signals || []) as { symbol: string; shiftScore: number; reasoning: string }[])
    .filter(s => s.shiftScore >= 60).slice(0, 5);

  // Supply-demand imbalance (SNDK core pattern)
  const sdData = get("supply-demand");
  const supplyDemand = ((sdData?.strongPatterns || []) as { symbol: string; score: number; phase: string; triggers: string[] }[])
    .slice(0, 5);

  // Convergence: when multiple signal layers agree on same stock
  const convData = get("convergence");
  const convergence = ((convData?.signals || []) as { symbol: string; convergenceScore: number; layerCount: number; urgency: string; reasoning: string }[])
    .slice(0, 5);

  // Exit signals
  const exitData = get("exit-signals");
  const exitAlerts = ((exitData?.signals || []) as { symbol: string; signal: string; urgency: number; detail: string }[])
    .filter(s => s.urgency >= 60);

  // Position health
  const healthData = get("position-health");
  const healthItems = (healthData?.health || []) as { flags: string[] }[];
  const atRisk = healthItems.filter(h => h.flags.length > 0).length;

  // Action items: combine all urgencies
  const actionItems: string[] = [];

  // CONVERGENCE is the highest priority action item
  const criticalConvergence = convergence.filter(c => c.urgency === "CRITICAL" || c.urgency === "HIGH");
  if (criticalConvergence.length > 0) {
    actionItems.push(`🔥🔥 CONVERGENCE: ${criticalConvergence.map(c => `${c.symbol}(${c.layerCount}/5 layers, ${c.convergenceScore}%)`).join(", ")} — HIGHEST CONVICTION`);
  }

  if (exitAlerts.length > 0) {
    actionItems.push(`🚨 EXIT: ${exitAlerts.map(e => `${e.symbol} (${e.signal})`).join(", ")}`);
  }
  if (topPicks.length > 0 && topPicks[0].compositeScore >= 70) {
    actionItems.push(`🎯 BUY CANDIDATE: ${topPicks[0].symbol} (score ${topPicks[0].compositeScore}${topPicks[0].entryPattern ? `, entry: ${topPicks[0].entryPattern}` : ""})`);
  }
  if (instAccumulating.length > 0) {
    actionItems.push(`🏦 ACCUMULATION: ${instAccumulating.map(i => `${i.symbol}(${i.signal})`).join(", ")}`);
  }
  if (optionsSignals.some(o => o.signal === "SMART_MONEY_CALL")) {
    const smCalls = optionsSignals.filter(o => o.signal === "SMART_MONEY_CALL");
    actionItems.push(`📞 SMART MONEY CALLS: ${smCalls.map(s => s.symbol).join(", ")}`);
  }
  if (shifts.length > 0) {
    actionItems.push(`🏭 STRUCTURAL SHIFT: ${shifts.map(s => `${s.symbol}(${s.shiftScore})`).join(", ")}`);
  }
  if (supplyDemand.length > 0) {
    actionItems.push(`⚡ SNDK PATTERN: ${supplyDemand.map(s => `${s.symbol}(${s.score}/100, ${s.phase})`).join(", ")}`);
  }
  if (volRegime === "EXTREME") {
    actionItems.push("⚠️ EXTREME VOL: Reduce exposure, wait for regime change");
  }
  if (atRisk > 0) {
    actionItems.push(`🏥 ${atRisk} position(s) at risk — review /health`);
  }

  return {
    marketConditions: { volRegime, breadthRegime, consensusThreshold, sizeMultiplier },
    topPicks,
    optionsFlow: optionsSignals,
    institutionalAccumulation: instAccumulating,
    structuralShifts: shifts,
    supplyDemand,
    convergence,
    exitAlerts,
    positionHealth: { totalPositions: healthItems.length, atRisk, summary: (healthData?.summary as string) || "No positions" },
    actionItems,
  };
}

function buildTextSummary(digest: DailyDigest["digest"], date: string): string {
  const lines: string[] = [];
  lines.push(`═══════════════════════════════════════`);
  lines.push(`📊 DAILY INTELLIGENCE DIGEST — ${date}`);
  lines.push(`═══════════════════════════════════════`);
  lines.push("");

  // Market conditions
  lines.push(`🌡️ Market: Vol=${digest.marketConditions.volRegime} | Breadth=${digest.marketConditions.breadthRegime} | Consensus≥${digest.marketConditions.consensusThreshold} | Size=${digest.marketConditions.sizeMultiplier}x`);
  lines.push("");

  // Action items (most important)
  if (digest.actionItems.length > 0) {
    lines.push(`⚡ ACTION ITEMS:`);
    for (const item of digest.actionItems) lines.push(`  ${item}`);
    lines.push("");
  }

  // Top picks
  if (digest.topPicks.length > 0) {
    lines.push(`🎯 TOP PICKS:`);
    for (const pick of digest.topPicks) {
      lines.push(`  ${pick.symbol}: ${pick.compositeScore}/100 ${pick.signals.join(" ")}${pick.entryPattern ? ` [${pick.entryPattern}]` : ""}${pick.entryZone ? ` zone $${pick.entryZone.low.toFixed(2)}-$${pick.entryZone.high.toFixed(2)}` : ""}`);
    }
    lines.push("");
  }

  // Options flow
  if (digest.optionsFlow.length > 0) {
    lines.push(`📊 OPTIONS FLOW:`);
    for (const o of digest.optionsFlow) {
      lines.push(`  ${o.signal === "BULLISH_FLOW" || o.signal === "SMART_MONEY_CALL" ? "🟢" : "🔴"} ${o.symbol}: ${o.signal} (${o.strength}%) — ${o.reasoning.slice(0, 80)}`);
    }
    lines.push("");
  }

  // Institutional accumulation
  if (digest.institutionalAccumulation.length > 0) {
    lines.push(`🏦 INSTITUTIONAL:`);
    for (const i of digest.institutionalAccumulation) {
      lines.push(`  ${i.symbol}: ${i.signal} (${i.phase}, ${i.confidence}%)`);
    }
    lines.push("");
  }

  // Supply-demand imbalance (SNDK pattern)
  if (digest.supplyDemand.length > 0) {
    lines.push(`⚡ SNDK SUPPLY-DEMAND:`);
    for (const sd of digest.supplyDemand) {
      lines.push(`  ${sd.score >= 60 ? "🔥" : "📊"} ${sd.symbol}: ${sd.score}/100 (${sd.phase})`);
      if (sd.triggers.length > 0) lines.push(`    → ${sd.triggers[0]}`);
    }
    lines.push("");
  }

  // Convergence (highest conviction)
  if (digest.convergence.length > 0) {
    lines.push(`🎯 CONVERGENCE (multi-layer agreement):`);
    for (const c of digest.convergence) {
      lines.push(`  ${c.urgency === "CRITICAL" ? "🔥🔥" : "🔥"} ${c.symbol}: ${c.convergenceScore}/100 (${c.layerCount}/5 layers)`);
      lines.push(`    ${c.reasoning.slice(0, 100)}`);
    }
    lines.push("");
  }

  // Exit alerts
  if (digest.exitAlerts.length > 0) {
    lines.push(`🚨 EXIT SIGNALS:`);
    for (const e of digest.exitAlerts) {
      lines.push(`  ${e.symbol}: ${e.signal} (urgency ${e.urgency}%) — ${e.detail}`);
    }
    lines.push("");
  }

  // Position health
  lines.push(`🏥 Positions: ${digest.positionHealth.totalPositions} open, ${digest.positionHealth.atRisk} at risk`);
  lines.push("");
  lines.push(`═══════════════════════════════════════`);

  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pipelineStart = Date.now();
  const baseUrl = process.env.ZEABUR_URL || `http://localhost:${process.env.PORT || 3000}`;
  const sendTelegram = req.nextUrl.searchParams.get("notify") !== "false";
  const skipAnalysis = req.nextUrl.searchParams.get("skip_analysis") === "true";

  // Step 0: Run base analysis first (so signal-composite has fresh data)
  if (!skipAnalysis) {
    try {
      await fetch(`${baseUrl}/api/cron/run-analysis`, {
        method: "POST",
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
        signal: AbortSignal.timeout(60000),
      });
    } catch { /* non-critical — composite can still read stale data */ }
  }

  // Run all stages in parallel (grouped by dependency)
  // Group 1: no dependencies (market-level)
  const [volStage, breadthStage] = await Promise.all([
    fetchStage(baseUrl, "/api/cron/volatility-regime", "volatility-regime"),
    fetchStage(baseUrl, "/api/cron/market-breadth", "market-breadth"),
  ]);

  // Group 2: stock-level analysis (can run in parallel)
  const [compositeStage, entryStage, exitStage, optionsStage, instStage, shiftStage, healthStage, supplyDemandStage, convergenceStage] = await Promise.all([
    fetchStage(baseUrl, "/api/cron/signal-composite", "signal-composite"),
    fetchStage(baseUrl, "/api/cron/entry-timing", "entry-timing"),
    fetchStage(baseUrl, "/api/cron/exit-signals", "exit-signals"),
    fetchStage(baseUrl, "/api/cron/options-flow", "options-flow"),
    fetchStage(baseUrl, "/api/cron/institutional-tracker", "institutional-tracker"),
    fetchStage(baseUrl, "/api/cron/structural-shift", "structural-shift"),
    fetchStage(baseUrl, "/api/cron/position-health", "position-health"),
    fetchStage(baseUrl, "/api/cron/supply-demand", "supply-demand"),
    fetchStage(baseUrl, "/api/cron/convergence", "convergence"),
  ]);

  const allStages = [volStage, breadthStage, compositeStage, entryStage, exitStage, optionsStage, instStage, shiftStage, healthStage, supplyDemandStage, convergenceStage];

  // Build unified digest
  const digest = buildDigest(allStages);
  const today = new Date().toISOString().split("T")[0];
  const textSummary = buildTextSummary(digest, today);
  const pipelineDurationMs = Date.now() - pipelineStart;

  const result: DailyDigest = {
    date: today,
    generatedAt: new Date().toISOString(),
    pipeline: allStages.map(({ data: _d, ...rest }) => rest), // strip raw data from pipeline status
    digest,
    textSummary,
    pipelineDurationMs,
  };

  // Store digest in Supabase
  const supabase = trySupabase();
  if (supabase) {
    try {
      await supabase.from("analysis_runs").upsert({
        date: today,
        ts: Date.now(),
        results: { type: "pipeline_digest", digest, pipelineDurationMs, stageStatus: allStages.map(s => ({ name: s.name, status: s.status, ms: s.durationMs })) },
      }, { onConflict: "date" });
    } catch { /* non-critical */ }
  }

  // Send to Telegram
  if (sendTelegram) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (token && chatId) {
      // Trim to Telegram's 4096 char limit
      const msg = textSummary.length > 4000 ? textSummary.slice(0, 3950) + "\n\n[truncated]" : textSummary;
      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: msg }),
        });
      } catch { /* non-critical */ }

      // Send SEPARATE urgent alert for CRITICAL convergence (ensures it's not lost in digest)
      const criticalConv = digest.convergence.filter(c => c.urgency === "CRITICAL" || c.urgency === "HIGH");
      if (criticalConv.length > 0) {
        const alertLines = criticalConv.map(c =>
          `⚡ <b>${c.symbol}</b> — ${c.convergenceScore}/100 (${c.layerCount}/5 layers)\n   ${c.reasoning}`
        );
        const urgentMsg = `🔥🔥🔥 <b>CONVERGENCE ALERT</b> 🔥🔥🔥\n\n${alertLines.join("\n\n")}\n\n⚡ Multiple independent signals agree. HIGHEST conviction. Review immediately.`;
        try {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: urgentMsg, parse_mode: "HTML" }),
          });
        } catch { /* non-critical */ }
      }
    }
  }

  return NextResponse.json(result);
}
