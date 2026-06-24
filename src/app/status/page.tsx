"use client";
import { useState, useEffect } from "react";
import ScoreChart from "@/components/ScoreChart";

interface SystemSummary {
  status: string;
  lastRun: { date: string; hoursAgo: number } | null;
  openPositions: number;
  watchlistSize: number;
  weeklyConsensusPicks: number;
  weeklyScans: number;
  crons: Record<string, string>;
}

export default function StatusPage() {
  const [summary, setSummary] = useState<SystemSummary | null>(null);
  const [chartSymbol, setChartSymbol] = useState("NVDA");
  const [symbolInput, setSymbolInput] = useState("NVDA");

  useEffect(() => {
    fetch("/api/dashboard/summary")
      .then(r => r.json())
      .then(setSummary)
      .catch(() => null);
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <h1 className="text-2xl font-bold mb-6">📡 System Status</h1>

      {/* Health Banner */}
      {summary && (
        <div className={`mb-6 p-4 rounded-lg border ${summary.status === "healthy" ? "border-green-800 bg-green-950/30" : "border-yellow-800 bg-yellow-950/30"}`}>
          <span className="text-lg font-bold">
            {summary.status === "healthy" ? "🟢 Healthy" : "🟡 Stale"}
          </span>
          {summary.lastRun && (
            <span className="ml-3 text-sm text-gray-400">Last run: {summary.lastRun.date} ({summary.lastRun.hoursAgo}h ago)</span>
          )}
        </div>
      )}

      {/* Stats Grid */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card label="Open Positions" value={String(summary.openPositions)} />
          <Card label="Watchlist" value={String(summary.watchlistSize)} />
          <Card label="Weekly Picks" value={String(summary.weeklyConsensusPicks)} color={summary.weeklyConsensusPicks > 0 ? "green" : undefined} />
          <Card label="Weekly Scans" value={String(summary.weeklyScans)} />
        </div>
      )}

      {/* Cron Schedules */}
      {summary?.crons && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-2">⏰ Cron Schedules</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {Object.entries(summary.crons).map(([name, schedule]) => (
              <div key={name} className="bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm flex justify-between">
                <span className="text-gray-300">{name}</span>
                <span className="text-gray-500 font-mono">{schedule}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scoring History Chart */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">📈 Scoring History</h2>
        <div className="flex gap-2 mb-3">
          <input
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm w-32"
            value={symbolInput}
            onChange={e => setSymbolInput(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === "Enter") setChartSymbol(symbolInput); }}
            placeholder="Symbol"
          />
          <button onClick={() => setChartSymbol(symbolInput)} className="bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded text-sm">
            Load
          </button>
          {["NVDA", "TSLA", "AAPL", "SMCI"].map(s => (
            <button key={s} onClick={() => { setSymbolInput(s); setChartSymbol(s); }}
              className={`px-2 py-1 rounded text-xs ${chartSymbol === s ? "bg-blue-700" : "bg-gray-800 hover:bg-gray-700"}`}>
              {s}
            </button>
          ))}
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <ScoreChart symbol={chartSymbol} />
        </div>
      </div>

      {!summary && <p className="text-gray-500 text-center mt-12">Loading system status...</p>}
    </div>
  );
}

function Card({ label, value, color }: { label: string; value: string; color?: "green" | "red" }) {
  const textColor = color === "green" ? "text-green-400" : color === "red" ? "text-red-400" : "text-white";
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-lg font-bold font-mono ${textColor}`}>{value}</div>
    </div>
  );
}
