"use client";

export default function RiskGauge({ score }: { score: number }) {
  const color = score <= 3 ? "#00ff88" : score <= 5 ? "#ffcc00" : score <= 7 ? "#ff8800" : "#ff3366";
  const label = score <= 3 ? "低風險" : score <= 5 ? "中等風險" : score <= 7 ? "中高風險" : "高風險";
  const angle = (score / 10) * 180 - 90; // -90 to 90 degrees

  return (
    <div className="glass-card p-4 flex flex-col items-center">
      <h3 className="text-sm font-semibold mb-3 text-[var(--neon-cyan)] self-start">風險評估</h3>
      <svg width="120" height="70" viewBox="0 0 120 70">
        {/* Background arc */}
        <path d="M 10 65 A 50 50 0 0 1 110 65" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" strokeLinecap="round" />
        {/* Colored arc */}
        <path d="M 10 65 A 50 50 0 0 1 110 65" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${(score / 10) * 157} 157`} opacity="0.8" />
        {/* Needle */}
        <line x1="60" y1="65" x2={60 + 35 * Math.cos((angle * Math.PI) / 180)} y2={65 + 35 * Math.sin((angle * Math.PI) / 180)}
          stroke={color} strokeWidth="2" strokeLinecap="round" />
        <circle cx="60" cy="65" r="4" fill={color} />
      </svg>
      <div className="text-center mt-1">
        <span className="text-2xl font-bold" style={{ color }}>{score}</span>
        <span className="text-sm text-[var(--text-secondary)]">/10</span>
      </div>
      <span className="text-xs mt-0.5" style={{ color }}>{label}</span>
    </div>
  );
}
