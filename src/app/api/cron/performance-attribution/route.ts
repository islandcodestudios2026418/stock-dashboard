import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/performance-attribution — which agent's calls were most accurate?
// Compares agent scores at entry vs actual outcome to grade each agent's contribution.

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

interface AgentStats {
  agent: string;
  callsMade: number;
  avgScoreOnWins: number;
  avgScoreOnLosses: number;
  accuracy: number; // % of times score>65 led to positive return
  contribution: number; // net P&L attributed to this agent's bullish calls
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  // Get closed positions
  const { data: positions } = await supabase
    .from("portfolio_positions")
    .select("*")
    .in("status", ["closed", "stopped"]);

  if (!positions || positions.length === 0) {
    return NextResponse.json({ message: "No closed positions for attribution", agents: [] });
  }

  // For each closed position, find the analysis_results entry at entry_date
  const agentMap: Record<string, { wins: number[]; losses: number[]; pnls: number[] }> = {};

  for (const pos of positions) {
    if (!pos.exit_price || !pos.entry_price) continue;
    const pctReturn = (pos.exit_price - pos.entry_price) / pos.entry_price;
    const isWin = pctReturn > 0;

    // Look up scoring at entry date
    const { data: analysis } = await supabase
      .from("analysis_results")
      .select("scoring")
      .eq("symbol", pos.symbol)
      .eq("date", pos.entry_date)
      .single();

    if (!analysis?.scoring?.agents) continue;

    for (const agent of analysis.scoring.agents) {
      const name = agent.agent;
      if (!agentMap[name]) agentMap[name] = { wins: [], losses: [], pnls: [] };
      if (agent.score >= 65) {
        // Agent was bullish — track if that call was correct
        if (isWin) agentMap[name].wins.push(agent.score);
        else agentMap[name].losses.push(agent.score);
        agentMap[name].pnls.push(pctReturn * 100);
      }
    }
  }

  const agents: AgentStats[] = Object.entries(agentMap).map(([agent, data]) => {
    const total = data.wins.length + data.losses.length;
    const avgWin = data.wins.length > 0 ? data.wins.reduce((a, b) => a + b, 0) / data.wins.length : 0;
    const avgLoss = data.losses.length > 0 ? data.losses.reduce((a, b) => a + b, 0) / data.losses.length : 0;
    const accuracy = total > 0 ? (data.wins.length / total) * 100 : 0;
    const contribution = data.pnls.reduce((a, b) => a + b, 0);
    return { agent, callsMade: total, avgScoreOnWins: +avgWin.toFixed(1), avgScoreOnLosses: +avgLoss.toFixed(1), accuracy: +accuracy.toFixed(1), contribution: +contribution.toFixed(1) };
  });

  agents.sort((a, b) => b.accuracy - a.accuracy);

  // Also check analysis_results for "hindsight" accuracy (score at time vs subsequent 30d return)
  const days = parseInt(req.nextUrl.searchParams.get("days") || "30");
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
  const { data: recentAnalyses } = await supabase
    .from("analysis_results")
    .select("symbol, date, scoring")
    .gte("date", cutoff)
    .order("date", { ascending: true });

  let hindsight: { agent: string; bullishCalls: number; correctCalls: number; accuracy: number }[] = [];
  if (recentAnalyses && recentAnalyses.length > 1) {
    const hindsightMap: Record<string, { bullish: number; correct: number }> = {};
    // Group by symbol to compute next-day returns
    const bySymbol: Record<string, typeof recentAnalyses> = {};
    for (const r of recentAnalyses) {
      const s = r.symbol;
      if (!bySymbol[s]) bySymbol[s] = [];
      bySymbol[s].push(r);
    }

    for (const [, entries] of Object.entries(bySymbol)) {
      for (let i = 0; i < entries.length - 1; i++) {
        const cur = entries[i];
        const next = entries[i + 1];
        if (!cur.scoring?.agents || !next.scoring?.avgScore) continue;
        const improved = next.scoring.avgScore > cur.scoring.avgScore;
        for (const agent of cur.scoring.agents) {
          if (!hindsightMap[agent.agent]) hindsightMap[agent.agent] = { bullish: 0, correct: 0 };
          if (agent.score >= 65) {
            hindsightMap[agent.agent].bullish++;
            if (improved) hindsightMap[agent.agent].correct++;
          }
        }
      }
    }

    hindsight = Object.entries(hindsightMap).map(([agent, d]) => ({
      agent, bullishCalls: d.bullish, correctCalls: d.correct,
      accuracy: d.bullish > 0 ? +((d.correct / d.bullish) * 100).toFixed(1) : 0,
    }));
    hindsight.sort((a, b) => b.accuracy - a.accuracy);
  }

  return NextResponse.json({
    closedTrades: positions.length,
    agentAttribution: agents,
    hindsight: { period: `${days}d`, agents: hindsight },
    bestAgent: agents[0]?.agent || "N/A",
    worstAgent: agents[agents.length - 1]?.agent || "N/A",
  });
}
