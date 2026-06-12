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
  const [dateOffset, setDateOffset] = useState(0);
  const [dates, setDates] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState("");
  const [showWatchlist, setShowWatchlist] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [newSymbol, setNewSymbol] = useState("");

  useEffect(() => {
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

  const fetchWatchlist = () => {
    fetch("/api/cron/watchlist")
      .then(r => r.json())
      .then(d => setWatchlist(d.symbols || []))
      .catch(() => {});
  };

  useEffect(() => { if (showWatchlist) fetchWatchlist(); }, [showWatchlist]);

  const runNow = async () => {
    const secret = localStorage.getItem("cron-secret") || prompt("輸入 CRON_SECRET:");
    if (!secret) return;
    localStorage.setItem("cron-secret", secret);
    setRunning(true);
    setRunMsg("");
    try {
      const res = await fetch("/api/cron/manual", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      const d = await res.json();
      if (res.ok) {
        setRunMsg(`✅ 完成 (${d.results?.length || 0} symbols)`);
        setDateOffset(0);
        // Refresh data
        const r2 = await fetch("/api/cron/results");
        const d2 = await r2.json();
        if (d2.count > 0) setData(d2);
      } else {
        setRunMsg(`❌ ${d.error || res.statusText}`);
      }
    } catch (e) {
      setRunMsg(`❌ ${e instanceof Error ? e.message : "Network error"}`);
    } finally {
      setRunning(false);
    }
  };

  const addSymbol = async () => {
    if (!newSymbol.trim()) return;
    const secret = localStorage.getItem("cron-secret");
    if (!secret) { setRunMsg("請先點 Run Now 設定 CRON_SECRET"); return; }
    await fetch("/api/cron/watchlist", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: newSymbol.trim().toUpperCase() }),
    });
    setNewSymbol("");
    fetchWatchlist();
  };

  const removeSymbol = async (symbol: string) => {
    const secret = localStorage.getItem("cron-secret");
    if (!secret) return;
    await fetch("/api/cron/watchlist", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    });
    fetchWatchlist();
  };

  if (!data && dates.length === 0 && !showWatchlist) return null;

  const age = data ? Math.round((Date.now() - data.ts) / 3600000) : 0;
  const canPrev = dateOffset < dates.length - 1;
  const canNext = dateOffset > 0;

  return (
    <div className="glass-card p-3 border border-[rgba(0,240,255,0.2)]">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-[var(--neon-cyan)]">📊 每日自動分析</h3>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowWatchlist(v => !v)}
            className="px-1.5 py-0.5 text-xs rounded border border-[var(--border)] hover:border-[var(--neon-cyan)]"
            title="管理自選股">⚙️</button>
          <button onClick={runNow} disabled={running}
            className="px-2 py-0.5 text-xs rounded border border-[var(--neon-green)] text-[var(--neon-green)] hover:bg-[var(--neon-green)] hover:text-black disabled:opacity-50 transition-colors"
            title="立即執行分析">
            {running ? "⏳" : "▶ Run"}
          </button>
          <button disabled={!canPrev} onClick={() => setDateOffset(o => o + 1)}
            className="px-1.5 py-0.5 text-xs rounded border border-[var(--border)] disabled:opacity-30 hover:border-[var(--neon-cyan)]">◀</button>
          <span className="text-xs text-[var(--text-secondary)] min-w-[90px] text-center">
            {data?.date || "—"} {data && age < 24 ? `(${age}h ago)` : ""}
          </span>
          <button disabled={!canNext} onClick={() => setDateOffset(o => o - 1)}
            className="px-1.5 py-0.5 text-xs rounded border border-[var(--border)] disabled:opacity-30 hover:border-[var(--neon-cyan)]">▶</button>
        </div>
      </div>

      {runMsg && <p className="text-xs mb-2 text-[var(--text-secondary)]">{runMsg}</p>}

      {showWatchlist && (
        <div className="mb-2 p-2 rounded border border-[var(--border)] bg-[rgba(0,0,0,0.3)]">
          <div className="flex gap-1 mb-1">
            <input value={newSymbol} onChange={e => setNewSymbol(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addSymbol()}
              placeholder="NASDAQ:SMCI" className="flex-1 px-2 py-0.5 text-xs bg-transparent border border-[var(--border)] rounded" />
            <button onClick={addSymbol} className="px-2 py-0.5 text-xs rounded border border-[var(--neon-green)] text-[var(--neon-green)] hover:bg-[var(--neon-green)] hover:text-black">+</button>
          </div>
          <div className="flex flex-wrap gap-1">
            {watchlist.map(s => (
              <span key={s} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded bg-[rgba(0,240,255,0.1)] border border-[var(--border)]">
                {s}
                <button onClick={() => removeSymbol(s)} className="text-red-400 hover:text-red-300 ml-0.5">×</button>
              </span>
            ))}
            {watchlist.length === 0 && <span className="text-xs text-[var(--text-secondary)]">載入中...</span>}
          </div>
        </div>
      )}

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
