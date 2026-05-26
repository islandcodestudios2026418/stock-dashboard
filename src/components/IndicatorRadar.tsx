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

const statusLabel = (s: IndicatorStatus) =>
  s === "bullish" ? "多頭" : s === "bearish" ? "空頭" : "中性";

export default function IndicatorRadar({ data }: { data: IndicatorData }) {
  const indicators = [
    { name: "MACD", status: data.macd.status },
    { name: "RSI", status: data.rsi.status },
    { name: "KDJ", status: data.kdj.status },
    { name: "均線", status: data.ma.status },
    { name: "量能", status: data.volume.status },
  ];

  // Pentagon radar SVG
  const cx = 130, cy = 130, r = 100;
  const angles = indicators.map((_, i) => (i * 2 * Math.PI) / 5 - Math.PI / 2);
  const points = angles.map(a => [cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  const valueR = indicators.map(ind => ind.status === "bullish" ? 0.9 : ind.status === "neutral" ? 0.55 : 0.25);
  const valuePoints = angles.map((a, i) => [cx + r * valueR[i] * Math.cos(a), cy + r * valueR[i] * Math.sin(a)]);

  return (
    <div className="glass-card p-4">
      <h3 className="text-sm font-semibold mb-3 text-[var(--neon-cyan)]">關鍵指標雷達（日線）</h3>
      <div className="flex items-center gap-4">
        <svg width="260" height="260" viewBox="0 0 260 260">
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
            <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={statusColor(indicators[i].status)} />
          ))}
          {/* Labels */}
          {points.map((p, i) => (
            <text key={i} x={p[0] + (p[0] > cx ? 5 : p[0] < cx ? -5 : 0)}
              y={p[1] + (p[1] > cy ? 14 : p[1] < cy ? -6 : 0)}
              textAnchor="middle" fontSize="11" fill="#8888aa">
              {indicators[i].name}
            </text>
          ))}
        </svg>
        <div className="flex flex-col gap-2 text-sm">
          {indicators.map(ind => (
            <div key={ind.name} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: statusColor(ind.status) }} />
              <span className="text-[var(--text-secondary)]">{ind.name}</span>
              <span style={{ color: statusColor(ind.status) }}>{statusLabel(ind.status)}</span>
            </div>
          ))}
          <div className="mt-2 text-xs text-[var(--text-secondary)]">
            <span className="inline-block w-2 h-2 rounded-full bg-[#00ff88] mr-1" />強勢(&gt;70)
            <span className="inline-block w-2 h-2 rounded-full bg-[#ffcc00] mr-1 ml-2" />中性(40-70)
            <span className="inline-block w-2 h-2 rounded-full bg-[#ff3366] mr-1 ml-2" />弱勢(&lt;40)
          </div>
        </div>
      </div>
    </div>
  );
}
