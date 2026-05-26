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

export default function SectorHeatmap({ lang = "zh-TW" }: { lang?: string }) {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const en = lang === "en";
  const enNames: Record<string, string> = { "\u91AB\u7642": "Health", "\u79D1\u6280": "Tech", "\u516C\u7528": "Util", "\u5DE5\u696D": "Indus", "\u80FD\u6E90": "Energy", "\u6750\u6599": "Mater", "\u91D1\u878D": "Finan", "\u6D88\u8CBB": "Discr", "\u5FC5\u9700": "Stapl", "\u5730\u7522": "Real E", "\u901A\u8A0A": "Comm" };

  useEffect(() => {
    fetch("/api/sectors").then(r => r.json()).then(d => { if (Array.isArray(d)) setSectors(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading || sectors.length === 0) return null;

  return (
    <div className="glass-card px-3 py-2 shrink-0">
      <div className="flex items-center gap-1.5 overflow-x-auto">
        <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap mr-1">{en ? "Sectors" : "\u677F\u584A"}</span>
        {sectors.map(s => (
          <div key={s.short} className="flex flex-col items-center px-2 py-1 rounded" style={{ background: getColor(s.changePct) }}>
            <span className="text-[11px] font-bold text-white leading-none">{en ? (enNames[s.name] || s.short) : s.name}</span>
            <span className={`text-[11px] font-mono leading-none mt-0.5 ${s.changePct >= 0 ? "text-white" : "text-white"}`}>
              {s.changePct >= 0 ? "+" : ""}{s.changePct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
