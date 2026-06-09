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
  const [dateOffset, setDateOffset] = useState(0); // 0 = latest, -1 = yesterday, etc.
  const [dates, setDates] = useState<string[]>([]);

  useEffect(() => {
    // Fetch last 7 days to populate date nav
    fetch("/api/cron/results?days=7")
      .then(r => r.json())
      .then(d => {
        if (d.results?.length) {
          const uniqueDates = [...new Set(d.results.map((r: AnalysisResult) => r.date))] as string[];
          uniqueDates.sort((a, b) => b.localeCompare(a));
          setDates(uniqueDates);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const targetDate = dates[dateOffset] || "";
    const url = targetDate ? `/api/cron/results?date=${targetDate}` : "/api/cron/results";
    fetch(url)
      .then(r => r.json())
      .then(d => { if (d.count > 0) setData(d); else setData(null); })
      .catch(() => {});
  }, [dateOffset, dates]);

  if (!data && dates.length === 0) return null;

  const age = data ? Math.round((Date.now() - data.ts) / 3600000) : 0;
  const canPrev = dateOffset < dates.length - 1;
  const canNext = dateOffset > 0;

  return (
    <div className="glass-card p-3 border border-[rgba(0,240,255,0.2)]">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-[var(--neon-cyan)]">
          📊 每日自動分析
        </h3>
        <div className="flex items-center gap-1">
          <button disabled={!canPrev} onClick={() => setDateOffset(o => o + 1)}
            className="px-1.5 py-0.5 text-xs rounded border border-[var(--border)] disabled:opacity-30 hover:border-[var(--neon-cyan)]">◀</button>
          <span className="text-xs text-[var(--text-secondary)] min-w-[90px] text-center">
            {data?.date || "—"} {data && age < 24 ? `(${age}h ago)` : ""}
          </span>
          <button disabled={!canNext} onClick={() => setDateOffset(o => o - 1)}
            className="px-1.5 py-0.5 text-xs rounded border border-[var(--border)] disabled:opacity-30 hover:border-[var(--neon-cyan)]">▶</button>
        </div>
      </div>
      {data ? (
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
      ) : (
        <p className="text-xs text-[var(--text-secondary)]">此日無分析資料</p>
      )}
    </div>
  );
}
