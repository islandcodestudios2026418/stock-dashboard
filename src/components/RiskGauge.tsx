"use client";

export default function RiskGauge({ score, lang = "zh-TW" }: { score: number; lang?: string }) {
  const color = score <= 3 ? "#00ff88" : score <= 5 ? "#ffcc00" : score <= 7 ? "#ff8800" : "#ff3366";
  const en = lang === "en";
  const label = score <= 3 ? (en ? "Low" : "\u4F4E\u98A8\u96AA") : score <= 5 ? (en ? "Medium" : "\u4E2D\u7B49\u98A8\u96AA") : score <= 7 ? (en ? "Med-High" : "\u4E2D\u9AD8\u98A8\u96AA") : (en ? "High" : "\u9AD8\u98A8\u96AA");

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
