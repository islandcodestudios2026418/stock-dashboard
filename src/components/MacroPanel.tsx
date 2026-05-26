"use client";
import { useState, useEffect } from "react";

interface MacroItem { price: number; change: number; changePct: number; name: string; }
type MacroData = Record<string, MacroItem>;

export default function MacroPanel({ lang = "zh-TW" }: { lang?: string }) {
  const [data, setData] = useState<MacroData | null>(null);

  useEffect(() => {
    fetch("/api/macro").then(r => r.json()).then(setData).catch(() => {});
  }, []);

  if (!data) return null;

  const vix = data.vix?.price || 0;
  const blackSwan = vix > 30;
  const highAlert = vix > 25;
  const en = lang === "en";
  const names: Record<string, string> = en
    ? { vix: "VIX", dxy: "USD", us10y: "US10Y", us02y: "US2Y", spx: "S&P500", gold: "Gold" }
    : { vix: "VIX", dxy: "\u7F8E\u5143\u6307\u6578", us10y: "\u7F8E10\u5E74\u50B5", us02y: "\u7F8E2\u5E74\u50B5", spx: "S&P 500", gold: "\u9EC3\u91D1" };

  return (
    <div className="shrink-0">
      <div className="glass-card px-4 py-2 flex items-center gap-4 overflow-x-auto">
        {Object.entries(data).map(([key, item]) => {
          if (!item?.price) return null;
          const isUp = item.change >= 0;
          const isVixHigh = key === "vix" && item.price > 25;
          return (
            <div key={key} className={`flex items-center gap-2 whitespace-nowrap ${isVixHigh ? "text-[var(--neon-red)]" : ""}`}>
              <span className="text-xs text-[var(--text-secondary)]">{names[key] || item.name}</span>
              <span className="text-sm font-mono font-bold">{item.price.toFixed(2)}</span>
              <span className={`text-xs font-mono ${isUp ? "text-[var(--neon-green)]" : "text-[var(--neon-red)]"}`}>
                {isUp ? "▲" : "▼"}{Math.abs(item.changePct).toFixed(2)}%
              </span>
            </div>
          );
        })}
        {blackSwan && <span className="ml-auto text-xs font-bold text-[var(--neon-red)] animate-pulse">{en ? "🦢 BLACK SWAN ALERT VIX>30" : "🦢 黑天鵝警報 VIX>30"}</span>}
        {!blackSwan && highAlert && <span className="ml-auto text-xs font-bold text-[var(--neon-yellow)]">{en ? "⚠️ VIX Elevated" : "⚠️ VIX偏高"}</span>}
      </div>
    </div>
  );
}
