"use client";
import { useState, useEffect } from "react";

interface FundData {
  pe: number | null; forwardPe: number | null; pb: number | null;
  eps: number | null; forwardEps: number | null;
  revenue: number | null; revenueGrowth: number | null;
  profitMargin: number | null; roe: number | null;
  debtToEquity: number | null; dividendYield: number | null;
  marketCap: number | null; beta: number | null;
}

function fmtB(n: number | null) {
  if (n == null) return "—";
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  return n.toLocaleString();
}
function fmtPct(n: number | null) { return n != null ? `${(n * 100).toFixed(1)}%` : "—"; }
function fmtNum(n: number | null, d = 2) { return n != null ? n.toFixed(d) : "—"; }

export default function FundamentalsPanel({ symbol, lang = "zh-TW" }: { symbol: string; lang?: string }) {
  const [data, setData] = useState<FundData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    fetch(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}`)
      .then(r => r.json()).then(d => { if (!d.error) setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [symbol]);

  if (loading) return <div className="glass-card p-3 animate-pulse"><div className="h-3 bg-[rgba(0,240,255,0.1)] rounded w-1/2" /></div>;
  if (!data) return null;

  const en = lang === "en";
  const rows: [string, string][] = [
    [en ? "Mkt Cap" : "\u5E02\u503C", fmtB(data.marketCap)],
    ["P/E", fmtNum(data.pe)],
    [en ? "Fwd P/E" : "\u9810\u4F30P/E", fmtNum(data.forwardPe)],
    ["P/B", fmtNum(data.pb)],
    ["EPS", fmtNum(data.eps)],
    [en ? "Fwd EPS" : "\u9810\u4F30EPS", fmtNum(data.forwardEps)],
    [en ? "Revenue" : "\u71DF\u6536", fmtB(data.revenue)],
    [en ? "Rev Growth" : "\u71DF\u6536\u6210\u9577", fmtPct(data.revenueGrowth)],
    [en ? "Profit Margin" : "\u6DE8\u5229\u7387", fmtPct(data.profitMargin)],
    ["ROE", fmtPct(data.roe)],
    [en ? "D/E" : "\u8CA0\u50B5\u6BD4", fmtNum(data.debtToEquity, 1)],
    [en ? "Div Yield" : "\u6B96\u5229\u7387", fmtPct(data.dividendYield)],
  ];

  return (
    <div className="glass-card p-3">
      <h3 className="text-sm font-bold text-[var(--neon-cyan)] mb-2">{en ? "Fundamentals" : "\u57FA\u672C\u9762"}</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, val]) => (
          <div key={label} className="flex justify-between">
            <span className="text-[var(--text-secondary)]">{label}</span>
            <span className="font-mono">{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
