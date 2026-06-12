"use client";
import { useState } from "react";

interface Pick {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  avgScore: number;
  agents: { agent: string; score: number; signal: string }[];
  exitPrice?: number;
  exitDate?: string;
  returnPct?: number;
  maxDrawdown?: number;
  maxGain?: number;
  daysHeld?: number;
}

interface BacktestResult {
  config: { startDate: string; endDate: string; lookbackDays: number; holdingDays: number };
  symbols: string[];
  picks: Pick[];
  summary: { totalPicks: number; wins: number; losses: number; winRate: number; avgReturn: number; maxReturn: number; maxDrawdown: number; avgHoldDays: number };
}

export default function BacktestPage() {
  const [results, setResults] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ symbols: "NVDA,TSLA,SMCI,AMD", start: "2022-01-01", end: "2024-06-01", hold: "252" });

  async function runBacktest() {
    setLoading(true);
    try {
      const res = await fetch(`/api/backtest/run?symbols=${form.symbols}&start=${form.start}&end=${form.end}&hold=${form.hold}`);
      const data = await res.json();
      setResults(data);
    } catch { /* fallback: try loading local file */ }
    setLoading(false);
  }

  async function loadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setResults(JSON.parse(text));
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <h1 className="text-2xl font-bold mb-4">🔬 Walk-Forward Backtest</h1>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-6 items-end">
        <label className="flex flex-col text-sm">
          Symbols
          <input className="bg-gray-800 border border-gray-700 rounded px-2 py-1 mt-1 w-48" value={form.symbols} onChange={e => setForm({ ...form, symbols: e.target.value })} />
        </label>
        <label className="flex flex-col text-sm">
          Start
          <input type="date" className="bg-gray-800 border border-gray-700 rounded px-2 py-1 mt-1" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} />
        </label>
        <label className="flex flex-col text-sm">
          End
          <input type="date" className="bg-gray-800 border border-gray-700 rounded px-2 py-1 mt-1" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} />
        </label>
        <label className="flex flex-col text-sm">
          Hold (days)
          <input className="bg-gray-800 border border-gray-700 rounded px-2 py-1 mt-1 w-20" value={form.hold} onChange={e => setForm({ ...form, hold: e.target.value })} />
        </label>
        <button onClick={runBacktest} disabled={loading} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-1.5 rounded text-sm font-medium">
          {loading ? "Running..." : "Run Backtest"}
        </button>
        <label className="bg-gray-800 border border-gray-700 px-3 py-1.5 rounded text-sm cursor-pointer hover:bg-gray-700">
          Load JSON
          <input type="file" accept=".json" className="hidden" onChange={loadFile} />
        </label>
      </div>

      {/* Results */}
      {results && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Card label="Total Picks" value={results.summary.totalPicks.toString()} />
            <Card label="Win Rate" value={`${(results.summary.winRate * 100).toFixed(0)}%`} color={results.summary.winRate > 0.5 ? "green" : "red"} />
            <Card label="Avg Return" value={`${(results.summary.avgReturn * 100).toFixed(1)}%`} color={results.summary.avgReturn > 0 ? "green" : "red"} />
            <Card label="Max Drawdown" value={`${(results.summary.maxDrawdown * 100).toFixed(1)}%`} color="red" />
            <Card label="Max Return" value={`${(results.summary.maxReturn * 100).toFixed(1)}%`} color="green" />
            <Card label="Avg Hold" value={`${results.summary.avgHoldDays.toFixed(0)}d`} />
            <Card label="Wins / Losses" value={`${results.summary.wins}W / ${results.summary.losses}L`} />
            <Card label="Period" value={`${results.config.startDate} → ${results.config.endDate}`} />
          </div>

          {/* Picks Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400">
                  <th className="text-left p-2">Symbol</th>
                  <th className="text-left p-2">Entry</th>
                  <th className="text-right p-2">Price</th>
                  <th className="text-right p-2">Score</th>
                  <th className="text-right p-2">Return</th>
                  <th className="text-right p-2">Max DD</th>
                  <th className="text-right p-2">Max Gain</th>
                  <th className="text-right p-2">Days</th>
                  <th className="text-left p-2">Agents</th>
                </tr>
              </thead>
              <tbody>
                {results.picks.map((p, i) => (
                  <tr key={i} className="border-b border-gray-800 hover:bg-gray-900">
                    <td className="p-2 font-mono font-bold">{p.symbol}</td>
                    <td className="p-2">{p.entryDate}</td>
                    <td className="p-2 text-right">${p.entryPrice.toFixed(2)}</td>
                    <td className="p-2 text-right font-mono">{p.avgScore.toFixed(0)}</td>
                    <td className={`p-2 text-right font-mono ${(p.returnPct ?? 0) > 0 ? "text-green-400" : "text-red-400"}`}>
                      {p.returnPct != null ? `${(p.returnPct * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className="p-2 text-right text-red-400 font-mono">
                      {p.maxDrawdown != null ? `${(p.maxDrawdown * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className="p-2 text-right text-green-400 font-mono">
                      {p.maxGain != null ? `${(p.maxGain * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className="p-2 text-right">{p.daysHeld ?? "—"}</td>
                    <td className="p-2">
                      <div className="flex gap-1">
                        {p.agents.map((a, j) => (
                          <span key={j} title={`${a.agent}: ${a.score}`} className={`w-2 h-2 rounded-full ${a.score >= 70 ? "bg-green-400" : a.score >= 50 ? "bg-yellow-400" : "bg-red-400"}`} />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {results.picks.length === 0 && (
                  <tr><td colSpan={9} className="p-4 text-center text-gray-500">No consensus picks found in this period</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!results && !loading && (
        <p className="text-gray-500 text-center mt-12">Run a backtest or load a JSON results file to view results.</p>
      )}
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
