// Phase 2: LLM Orchestrator with multi-agent debate
// 5 agents analyze independently, then debate up to 5 rounds until consensus or deadlock.
// Communication: shared state object (no file I/O needed for serverless).

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
}

export interface AgentOpinion {
  agentId: string;
  score: number; // 0-100
  signal: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
  reasoning: string;
  conviction: number; // 1-10
  updatedAt: number;
}

export interface DebateRound {
  round: number;
  opinions: AgentOpinion[];
  consensusReached: boolean;
}

export interface OrchestrationResult {
  symbol: string;
  consensus: boolean;
  finalScore: number;
  rounds: DebateRound[];
  recommendation: string;
  totalTokens: number;
  durationMs: number;
}

export type LLMProvider = (systemPrompt: string, userPrompt: string) => Promise<string>;

const AGENTS: AgentConfig[] = [
  {
    id: "macro", name: "總經分析師",
    role: "Macro Economist — interest rates, industry cycles, structural shifts",
    systemPrompt: `You are a macro economist analyzing stocks for explosive growth potential (3000%+ in 1-2 years).
Focus on: industry structural shifts, supply-demand imbalances, policy tailwinds, secular trends.
Reference: SNDK 2013 (NAND supply crunch + smartphone growth = 3500% in 1 year).
Output JSON: { "score": 0-100, "signal": "STRONG_BUY"|"BUY"|"NEUTRAL"|"SELL"|"STRONG_SELL", "reasoning": "...", "conviction": 1-10 }`
  },
  {
    id: "technical", name: "技術分析師",
    role: "Technical Analyst — chart patterns, volume, momentum, breakouts",
    systemPrompt: `You are a technical analyst looking for explosive breakout setups.
Focus on: ADX trend strength, volume surge, VCP patterns, base breakouts, relative strength.
Key pattern: long consolidation (6+ months) → volume breakout → sustained momentum.
Output JSON: { "score": 0-100, "signal": "STRONG_BUY"|"BUY"|"NEUTRAL"|"SELL"|"STRONG_SELL", "reasoning": "...", "conviction": 1-10 }`
  },
  {
    id: "sentiment", name: "消息面分析師",
    role: "News/Sentiment Analyst — insider activity, supply deals, catalysts",
    systemPrompt: `You are a news/sentiment analyst tracking institutional activity and catalysts.
Focus on: insider buying clusters, supply agreements, analyst upgrades, short squeeze setups, earnings surprises.
Red flags: SEC investigations, auditor changes, insider selling.
Output JSON: { "score": 0-100, "signal": "STRONG_BUY"|"BUY"|"NEUTRAL"|"SELL"|"STRONG_SELL", "reasoning": "...", "conviction": 1-10 }`
  },
  {
    id: "fundamentals", name: "基本面分析師",
    role: "Fundamentals Analyst — revenue growth, margins, valuation, competitive moat",
    systemPrompt: `You are a fundamentals analyst evaluating explosive growth potential.
Focus on: revenue acceleration (QoQ), margin expansion, TAM growth, competitive positioning.
Key: revenue growth rate INCREASING (not just high) = structural shift signal.
Output JSON: { "score": 0-100, "signal": "STRONG_BUY"|"BUY"|"NEUTRAL"|"SELL"|"STRONG_SELL", "reasoning": "...", "conviction": 1-10 }`
  },
  {
    id: "risk", name: "風控經理",
    role: "Risk Manager — position sizing, stop loss, portfolio risk, timing",
    systemPrompt: `You are a risk manager with $30K capital, concentrated strategy (1-3 positions max).
Focus on: max drawdown risk, volatility, chase risk (extended from base), correlation with existing positions.
Rules: 40% absolute stop, 25% trailing stop from peak. Flag if entry is >20% above breakout level.
Output JSON: { "score": 0-100, "signal": "STRONG_BUY"|"BUY"|"NEUTRAL"|"SELL"|"STRONG_SELL", "reasoning": "...", "conviction": 1-10 }`
  },
];

const MAX_ROUNDS = 5;
const CONSENSUS_THRESHOLD = 65;

function parseAgentResponse(raw: string): Omit<AgentOpinion, "agentId" | "updatedAt"> | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      score: Math.max(0, Math.min(100, Number(parsed.score) || 50)),
      signal: parsed.signal || "NEUTRAL",
      reasoning: String(parsed.reasoning || ""),
      conviction: Math.max(1, Math.min(10, Number(parsed.conviction) || 5)),
    };
  } catch { return null; }
}

function buildDebatePrompt(agent: AgentConfig, symbol: string, data: string, prevRounds: DebateRound[]): string {
  let prompt = `Analyze ${symbol} for explosive growth potential.\n\nData:\n${data}\n`;
  if (prevRounds.length > 0) {
    const lastRound = prevRounds[prevRounds.length - 1];
    prompt += `\nPrevious round opinions from other agents:\n`;
    for (const op of lastRound.opinions) {
      if (op.agentId === agent.id) continue;
      prompt += `- ${op.agentId}: score=${op.score}, signal=${op.signal}, conviction=${op.conviction}\n  "${op.reasoning}"\n`;
    }
    prompt += `\nConsider their arguments but maintain your independent judgment. Update your score if persuaded.\n`;
  }
  return prompt;
}

export async function orchestrate(
  symbol: string,
  marketData: string, // pre-formatted data context (indicators, news, price action)
  llm: LLMProvider,
): Promise<OrchestrationResult> {
  const start = Date.now();
  const rounds: DebateRound[] = [];
  let totalTokens = 0; // approximate

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const opinions: AgentOpinion[] = [];

    // All 5 agents analyze in parallel
    const results = await Promise.all(
      AGENTS.map(async (agent) => {
        const userPrompt = buildDebatePrompt(agent, symbol, marketData, rounds);
        const response = await llm(agent.systemPrompt, userPrompt);
        totalTokens += response.length / 4; // rough estimate
        return { agentId: agent.id, response };
      })
    );

    for (const { agentId, response } of results) {
      const parsed = parseAgentResponse(response);
      opinions.push({
        agentId,
        score: parsed?.score ?? 50,
        signal: parsed?.signal ?? "NEUTRAL",
        reasoning: parsed?.reasoning ?? "parse error",
        conviction: parsed?.conviction ?? 5,
        updatedAt: Date.now(),
      });
    }

    const consensusReached = opinions.every(o => o.score >= CONSENSUS_THRESHOLD);
    rounds.push({ round: round + 1, opinions, consensusReached });

    // Stop early if consensus reached OR if all agents are entrenched (no score changes)
    if (consensusReached) break;
    if (round > 0) {
      const prev = rounds[round - 1].opinions;
      const unchanged = opinions.every((o, i) => Math.abs(o.score - prev[i].score) <= 2);
      if (unchanged) break; // deadlock
    }
  }

  const lastRound = rounds[rounds.length - 1];
  const finalScore = lastRound.opinions.reduce((s, o) => s + o.score, 0) / lastRound.opinions.length;
  const consensus = lastRound.consensusReached;

  const recommendation = consensus
    ? `🟢 全員共識 (${rounds.length}輪辯論) — 均分 ${finalScore.toFixed(0)}/100`
    : `⚪ 未達共識 (${rounds.length}輪) — 均分 ${finalScore.toFixed(0)}/100`;

  return { symbol, consensus, finalScore, rounds, recommendation, totalTokens: Math.round(totalTokens), durationMs: Date.now() - start };
}

export { AGENTS };
