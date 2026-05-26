"use client";
import { useState, useEffect } from "react";

interface Props { onSelect: (symbol: string) => void; currentSymbol?: string; }

export default function Watchlist({ onSelect, currentSymbol }: Props) {
  const [list, setList] = useState<string[]>([]);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("watchlist");
    if (saved) setList(JSON.parse(saved));
  }, []);

  const save = (newList: string[]) => { setList(newList); localStorage.setItem("watchlist", JSON.stringify(newList)); };
  const add = (symbol: string) => { if (!list.includes(symbol)) save([...list, symbol]); };
  const remove = (symbol: string) => save(list.filter(s => s !== symbol));
  const isInList = currentSymbol ? list.includes(currentSymbol) : false;

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        {currentSymbol && (
          <button onClick={() => isInList ? remove(currentSymbol) : add(currentSymbol)}
            className={`px-2 py-1 text-xs rounded border transition-all ${isInList ? "border-[var(--neon-yellow)] text-[var(--neon-yellow)]" : "border-[rgba(255,255,255,0.15)] text-[var(--text-secondary)] hover:border-[var(--neon-yellow)]"}`}>
            {isInList ? "★" : "☆"}
          </button>
        )}
        <button onClick={() => setShow(!show)}
          className="px-2 py-1 text-xs border border-[rgba(0,240,255,0.3)] rounded text-[var(--text-secondary)] hover:text-[var(--neon-cyan)]">
          自選({list.length})
        </button>
      </div>
      {show && list.length > 0 && (
        <div className="absolute top-full right-0 mt-1 glass-card p-2 z-50 min-w-[140px]">
          {list.map(s => (
            <div key={s} className="flex items-center justify-between gap-2 px-2 py-1 hover:bg-[rgba(0,240,255,0.05)] rounded">
              <button onClick={() => { onSelect(s); setShow(false); }} className="text-sm text-[var(--text-primary)] hover:text-[var(--neon-cyan)]">
                {s.split(":")[1] || s}
              </button>
              <button onClick={() => remove(s)} className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--neon-red)]">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
