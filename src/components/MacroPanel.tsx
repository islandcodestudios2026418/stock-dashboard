"use client";
import { useState, useEffect } from "react";

interface MacroItem { price: number; change: number; changePct: number; name: string; }
type MacroData = Record<string, MacroItem>;

const LABELS: Record<string, { icon: string; warn?: (v: number) => boolean }> = {
  vix: { icon: "⚡", warn: v => v > 25 },
  dxy: { icon: "💵" },
  us10y: { icon: "📈" },
  us02y: { icon: "📊" },
  spx: { icon: "🏛️" },
  gold: { icon: "🥇" },
};

export default function MacroPanel() {
  const [data, setData] = useState<MacroData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/macro").then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="glass-card p-3 animate-pulse h-full"><div className="h-3 bg-[rgba(0,240,255,0.1)] rounded w-1/2" /></div>;
  if (!data) return null;

  return (
    <div className="glass-card p-3">
      <h3 className="text-sm font-bold text-[var(--neon-cyan)] mb-2">📊 總經概覽</h3>
      <div className="grid grid-cols-3 gap-2">
        {Object.entries(data).map(([key, item]) => {
          if (!item || !item.price) return null;
          const isUp = item.change >= 0;
          const warn = LABELS[key]?.warn?.(item.price);
          return (
            <div key={key} className={`p-2 rounded-lg border ${warn ? "border-[var(--neon-red)] bg-[rgba(255,51,102,0.05)]" : "border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)]"}`}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="text-xs">{LABELS[key]?.icon}</span>
                <span className="text-[11px] text-[var(--text-secondary)]">{item.name}</span>
              </div>
              <div className="text-sm font-mono font-bold">{item.price.toFixed(2)}</div>
              <div className={`text-[11px] font-mono ${isUp ? "text-[var(--neon-green)]" : "text-[var(--neon-red)]"}`}>
                {isUp ? "+" : ""}{item.changePct.toFixed(2)}%
              </div>
            </div>
          );
        })}
      </div>
      {data.vix && data.vix.price > 25 && (
        <div className="mt-2 px-2 py-1 bg-[rgba(255,51,102,0.1)] border border-[var(--neon-red)] rounded text-xs text-[var(--neon-red)]">
          ⚠️ VIX &gt; 25 — 市場恐慌情緒升高，注意風險
        </div>
      )}
    </div>
  );
}
