// Walk-forward backtest engine: replays history day-by-day with NO look-ahead bias.
// For each day, uses only data available up to that point to run 5-agent scoring.

import { OHLCV } from "./indicators";
import { runMultiAgentScoring, ConsensusResult } from "./multi-agent-scoring";

export interface BacktestConfig {
  startDate: string; // YYYY-MM-DD — first day to start scoring
  endDate: string;   // YYYY-MM-DD — last day to score
  lookbackDays: number; // days of history needed before scoring (default 150)
  holdingDays: number;  // days to track after entry (default 504 = ~2 years)
  consensusThreshold?: number; // override default 65
}

export interface BacktestPick {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  avgScore: number;
  agents: { agent: string; score: number; signal: string }[];
  // Outcome (filled after holding period)
  exitPrice?: number;
  exitDate?: string;
  returnPct?: number;
  maxDrawdown?: number;
  maxGain?: number;
  daysHeld?: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  symbols: string[];
  picks: BacktestPick[];
  summary: {
    totalPicks: number;
    wins: number;
    losses: number;
    winRate: number;
    avgReturn: number;
    maxReturn: number;
    maxDrawdown: number;
    avgHoldDays: number;
  };
}

// Run walk-forward backtest on a single symbol
export function backtestSymbol(
  symbol: string,
  allData: OHLCV[],
  config: BacktestConfig
): BacktestPick[] {
  const picks: BacktestPick[] = [];
  const startTs = new Date(config.startDate).getTime() / 1000;
  const endTs = new Date(config.endDate).getTime() / 1000;
  const lookback = config.lookbackDays || 150;

  // Find index range for scoring window
  for (let i = lookback; i < allData.length; i++) {
    const day = allData[i];
    if (day.time < startTs || day.time > endTs) continue;

    // Use ONLY data up to this day (no look-ahead)
    const windowData = allData.slice(Math.max(0, i - lookback), i + 1);
    if (windowData.length < 60) continue;

    const result: ConsensusResult = runMultiAgentScoring(symbol, windowData);
    if (!result.consensus) continue;

    // Consensus found — record pick
    const entryDate = new Date(day.time * 1000).toISOString().split("T")[0];

    // Check if we already have a pick within last 30 trading days (avoid duplicate entries)
    const lastPick = picks[picks.length - 1];
    if (lastPick) {
      const lastIdx = allData.findIndex(d => d.time === Math.floor(new Date(lastPick.entryDate).getTime() / 1000));
      if (i - lastIdx < 30) continue;
    }

    // Track outcome using future data
    const futureData = allData.slice(i + 1, i + 1 + config.holdingDays);
    const pick: BacktestPick = {
      symbol,
      entryDate,
      entryPrice: day.close,
      avgScore: result.avgScore,
      agents: result.agents.map(a => ({ agent: a.agent, score: a.score, signal: a.signal })),
    };

    if (futureData.length > 0) {
      const entryPrice = day.close;
      let maxPrice = entryPrice;
      let minPrice = entryPrice;
      let exitIdx = futureData.length - 1;
      let exitReason = "hold_complete";

      // Simulate with stop-loss: 40% max DD or 25% trailing stop
      for (let fi = 0; fi < futureData.length; fi++) {
        const fd = futureData[fi];
        maxPrice = Math.max(maxPrice, fd.high);
        minPrice = Math.min(minPrice, fd.low);

        // 40% absolute stop-loss
        const ddFromEntry = (fd.low - entryPrice) / entryPrice;
        if (ddFromEntry <= -0.40) {
          exitIdx = fi; exitReason = "stop_40pct"; break;
        }
        // 25% trailing stop from peak
        const ddFromPeak = (fd.low - maxPrice) / maxPrice;
        if (ddFromPeak <= -0.25 && maxPrice > entryPrice * 1.1) {
          exitIdx = fi; exitReason = "trailing_25pct"; break;
        }
      }

      const exitDay = futureData[exitIdx];
      const exitPrice = exitReason === "hold_complete" ? exitDay.close
        : exitReason === "stop_40pct" ? entryPrice * 0.60
        : maxPrice * 0.75; // trailing stop exit price

      pick.exitPrice = exitPrice;
      pick.exitDate = new Date(exitDay.time * 1000).toISOString().split("T")[0];
      pick.returnPct = (exitPrice - entryPrice) / entryPrice;
      pick.maxDrawdown = (minPrice - entryPrice) / entryPrice;
      pick.maxGain = (maxPrice - entryPrice) / entryPrice;
      pick.daysHeld = exitIdx + 1;
    }

    picks.push(pick);
  }

  return picks;
}

// Summarize backtest results
export function summarizeBacktest(picks: BacktestPick[]): BacktestResult["summary"] {
  const completed = picks.filter(p => p.returnPct !== undefined);
  if (completed.length === 0) {
    return { totalPicks: picks.length, wins: 0, losses: 0, winRate: 0, avgReturn: 0, maxReturn: 0, maxDrawdown: 0, avgHoldDays: 0 };
  }

  const wins = completed.filter(p => p.returnPct! > 0).length;
  const returns = completed.map(p => p.returnPct!);
  const drawdowns = completed.map(p => p.maxDrawdown!);

  return {
    totalPicks: picks.length,
    wins,
    losses: completed.length - wins,
    winRate: wins / completed.length,
    avgReturn: returns.reduce((a, b) => a + b, 0) / returns.length,
    maxReturn: Math.max(...returns),
    maxDrawdown: Math.min(...drawdowns),
    avgHoldDays: completed.reduce((s, p) => s + (p.daysHeld || 0), 0) / completed.length,
  };
}
