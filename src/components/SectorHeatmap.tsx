"use client";
import { useState, useEffect } from "react";

interface Sector { symbol: string; name: string; short: string; changePct: number; }

function getColor(pct: number): string {
  if (pct > 2) return "rgba(0,255,136,0.8)";
  if (pct > 1) return "rgba(0,255,136,0.5)";
  if (pct > 0) return "rgba(0,255,136,0.25)";
  if (pct > -1) return "rgba(255,51,102,0.25)";
  if (pct > -2) return "rgba(255,51,102,0.5)";
  return "rgba(255,51,102,0.8)";
}

export default function SectorHeatmap() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/sectors").then(r => r.json()).then(d => { if (Array.isArray(d)) setSectors(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading || sectors.length === 0) return null;

  return (
    <div className="glass-card px-3 py-2 shrink-0">
      <div className="flex items-center gap-1.5 overflow-x-auto">
        <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap mr-1">板塊</span>
        {sectors.map(s => (
          <div key={s.short} className="flex flex-col items-center px-2 py-1 rounded" style={{ background: getColor(s.changePct) }}>
            <span className="text-[11px] font-bold text-white leading-none">{s.name}</span>
            <span className={`text-[11px] font-mono leading-none mt-0.5 ${s.changePct >= 0 ? "text-white" : "text-white"}`}>
              {s.changePct >= 0 ? "+" : ""}{s.changePct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
