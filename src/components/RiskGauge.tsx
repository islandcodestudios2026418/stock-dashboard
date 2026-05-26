"use client";

export default function RiskGauge({ score }: { score: number }) {
  const color = score <= 3 ? "#00ff88" : score <= 5 ? "#ffcc00" : score <= 7 ? "#ff8800" : "#ff3366";
  const label = score <= 3 ? "低風險" : score <= 5 ? "中等風險" : score <= 7 ? "中高風險" : "高風險";

  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        <span className="text-2xl font-bold" style={{ color }}>{score}</span>
        <span className="text-xs text-[var(--text-secondary)]">/10</span>
      </div>
      <div>
        <div className="flex gap-0.5">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="w-2 h-3 rounded-sm" style={{
              background: i < score ? color : "rgba(255,255,255,0.08)",
            }} />
          ))}
        </div>
        <div className="text-[10px] mt-0.5" style={{ color }}>{label}</div>
      </div>
    </div>
  );
}
