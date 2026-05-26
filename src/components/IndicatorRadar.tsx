"use client";
import { IndicatorStatus } from "@/lib/indicators";

interface IndicatorData {
  macd: { status: IndicatorStatus; dif: number; dea: number };
  rsi: { status: IndicatorStatus; value: number };
  kdj: { status: IndicatorStatus; k: number; d: number; j: number };
  ma: { status: IndicatorStatus; sma20: number | null };
  volume: { status: IndicatorStatus; current: number; avg20: number };
}

const statusColor = (s: IndicatorStatus) =>
  s === "bullish" ? "#00ff88" : s === "bearish" ? "#ff3366" : "#ffcc00";

const statusLabel = (s: IndicatorStatus, en: boolean) =>
  s === "bullish" ? (en ? "Bull" : "\u591A\u982D") : s === "bearish" ? (en ? "Bear" : "\u7A7A\u982D") : (en ? "Neut" : "\u4E2D\u6027");

export default function IndicatorRadar({ data, lang = "zh-TW" }: { data: IndicatorData; lang?: string }) {
  const en = lang === "en";
  const indicators = [
    { name: "MACD", status: data.macd.status },
    { name: "RSI", status: data.rsi.status },
    { name: "KDJ", status: data.kdj.status },
    { name: en ? "MA" : "\u5747\u7DDA", status: data.ma.status },
    { name: en ? "Vol" : "\u91CF\u80FD", status: data.volume.status },
  ];

  // Pentagon radar SVG
  const cx = 120, cy = 100, r = 80;
  const angles = indicators.map((_, i) => (i * 2 * Math.PI) / 5 - Math.PI / 2);
  const points = angles.map(a => [cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  const valueR = indicators.map(ind => ind.status === "bullish" ? 0.9 : ind.status === "neutral" ? 0.55 : 0.25);
  const valuePoints = angles.map((a, i) => [cx + r * valueR[i] * Math.cos(a), cy + r * valueR[i] * Math.sin(a)]);

  return (
    <div className="glass-card p-4">
      <h3 className="text-base font-semibold mb-2 text-[var(--neon-cyan)]">{en ? "Indicator Radar (Daily)" : "\u95DC\u9375\u6307\u6A19\u96F7\u9054\uFF08\u65E5\u7DDA\uFF09"}</h3>
      <svg width="100%" height="200" viewBox="0 0 240 200" className="mx-auto">
        {/* Grid */}
        {[0.33, 0.66, 1].map(scale => (
          <polygon key={scale} points={angles.map(a => `${cx + r * scale * Math.cos(a)},${cy + r * scale * Math.sin(a)}`).join(" ")}
            fill="none" stroke="rgba(0,240,255,0.15)" strokeWidth="0.5" />
        ))}
        {/* Axes */}
        {points.map((p, i) => (
          <line key={i} x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke="rgba(0,240,255,0.1)" strokeWidth="0.5" />
        ))}
        {/* Value polygon */}
        <polygon points={valuePoints.map(p => `${p[0]},${p[1]}`).join(" ")}
          fill="rgba(0,240,255,0.15)" stroke="var(--neon-cyan)" strokeWidth="1.5" />
        {/* Dots */}
        {valuePoints.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="4" fill={statusColor(indicators[i].status)} />
        ))}
        {/* Labels */}
        {points.map((p, i) => (
          <text key={i} x={p[0] + (p[0] > cx ? 8 : p[0] < cx ? -8 : 0)}
            y={p[1] + (p[1] > cy ? 16 : p[1] < cy ? -8 : 0)}
            textAnchor="middle" fontSize="13" fill="#a8a8cc">
            {indicators[i].name}
          </text>
        ))}
      </svg>
      <div className="flex items-center justify-center gap-4 mt-2 text-sm">
        {indicators.map(ind => (
          <div key={ind.name} className="flex flex-col items-center gap-0.5">
            <span className="text-[var(--text-secondary)]">{ind.name}</span>
            <span className="font-bold" style={{ color: statusColor(ind.status) }}>{statusLabel(ind.status, en)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
