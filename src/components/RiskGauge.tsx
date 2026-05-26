"use client";

export default function RiskGauge({ score }: { score: number }) {
  const color = score <= 3 ? "#00ff88" : score <= 5 ? "#ffcc00" : score <= 7 ? "#ff8800" : "#ff3366";
  const label = score <= 3 ? "低風險" : score <= 5 ? "中等" : score <= 7 ? "中高" : "高風險";

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="w-2 h-4 rounded-sm" style={{
            background: i < score ? color : "rgba(255,255,255,0.08)",
          }} />
        ))}
      </div>
      <div className="text-right">
        <span className="text-lg font-bold" style={{ color }}>{score}</span>
        <span className="text-xs text-[var(--text-secondary)]">/10</span>
        <div className="text-[10px]" style={{ color }}>{label}</div>
      </div>
    </div>
  );
}
