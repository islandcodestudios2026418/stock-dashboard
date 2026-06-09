"use client";
import { useEffect, useState } from "react";

interface AgentScore {
  agent: string;
  score: number;
  signal: string;
  reasoning: string;
}

interface AnalysisResult {
  symbol: string;
  date: string;
  scoring: {
    consensus: boolean;
    avgScore: number;
    agents: AgentScore[];
    recommendation: string;
  };
  tradePlan?: { entry: number; stopLoss: number; target1: number; target2: number; riskReward: number };
}

interface CronResults {
  date: string | null;
  ts: number;
  count: number;
  results: AnalysisResult[];
}

export default function DailyAnalysis({ onSelect }: { onSelect: (symbol: string) => void }) {
  const [data, setData] = useState<CronResults | null>(null);

  useEffect(() => {
    fetch("/api/cron/results")
      .then(r => r.json())
      .then(d => { if (d.count > 0) setData(d); })
      .catch(() => {});
  }, []);

  if (!data) return null;

  const age = Math.round((Date.now() - data.ts) / 3600000);

  return (
    <div className="glass-card p-3 border border-[rgba(0,240,255,0.2)]">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-[var(--neon-cyan)]">
          📊 每日自動分析 <span className="text-xs font-normal text-[var(--text-secondary)]">({data.date}, {age}h ago)</span>
        </h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {data.results.map((r) => (
          <button key={r.symbol} onClick={() => onSelect(r.symbol.includes(":") ? r.symbol : `NASDAQ:${r.symbol}`)}
            className="text-left p-2 rounded border border-[var(--border)] hover:border-[var(--neon-cyan)] transition-colors">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-bold">{r.symbol?.split(":")[1] || r.symbol}</span>
              <span className={`text-xs font-bold ${r.scoring?.consensus ? "text-[var(--neon-green)]" : "text-[var(--text-secondary)]"}`}>
                {r.scoring?.avgScore?.toFixed(0) || "?"}/100
              </span>
            </div>
            <div className="text-xs mt-1 truncate text-[var(--text-secondary)]">
              {r.scoring?.recommendation || "分析完成"}
            </div>
            {r.scoring?.agents && (
              <div className="flex gap-0.5 mt-1">
                {r.scoring.agents.map((a, i) => (
                  <div key={i} title={`${a.agent}: ${a.score}`}
                    className={`w-2 h-2 rounded-full ${a.score >= 65 ? "bg-green-400" : a.score >= 40 ? "bg-yellow-400" : "bg-red-400"}`} />
                ))}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
