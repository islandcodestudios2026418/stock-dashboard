"use client";
import { useState, useEffect } from "react";

interface HistoryPoint {
  date: string;
  avgScore: number;
  consensus: boolean;
  agents: { name: string; score: number }[];
}

export default function ScoreChart({ symbol }: { symbol: string }) {
  const [data, setData] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/cron/history?symbol=${encodeURIComponent(symbol)}&days=30`)
      .then(r => r.json())
      .then(d => setData(d.history || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) return <div className="text-gray-500 text-sm">Loading...</div>;
  if (data.length === 0) return <div className="text-gray-500 text-sm">No history data</div>;

  const maxScore = 100;
  const h = 120;
  const w = Math.max(data.length * 16, 200);

  // Build SVG path
  const points = data.map((d, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * (w - 20) + 10;
    const y = h - (d.avgScore / maxScore) * (h - 20) - 10;
    return { x, y, ...d };
  });
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  // Consensus threshold line
  const thresholdY = h - (65 / maxScore) * (h - 20) - 10;

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={h} className="block">
        {/* Threshold line */}
        <line x1={10} y1={thresholdY} x2={w - 10} y2={thresholdY} stroke="#4b5563" strokeDasharray="4 2" strokeWidth={1} />
        <text x={w - 8} y={thresholdY - 3} fill="#6b7280" fontSize={9} textAnchor="end">65</text>

        {/* Score line */}
        <path d={pathD} fill="none" stroke="#60a5fa" strokeWidth={2} />

        {/* Data points */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={p.consensus ? 4 : 2.5}
            fill={p.consensus ? "#34d399" : "#60a5fa"}
            stroke={p.consensus ? "#10b981" : "none"} strokeWidth={1}>
            <title>{`${p.date}: ${p.avgScore.toFixed(0)}/100${p.consensus ? " ✓" : ""}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-500 px-2 mt-1">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}
