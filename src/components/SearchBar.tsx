"use client";
import { useState, useCallback } from "react";

interface Props {
  onSearch: (symbol: string) => void;
  loading?: boolean;
}

const POPULAR = ["NASDAQ:TSLA", "NASDAQ:AAPL", "NASDAQ:NVDA", "NASDAQ:MSFT", "NYSE:PLTR", "TWSE:2330", "TWSE:2317", "NASDAQ:TQQQ"];

export default function SearchBar({ onSearch, loading }: Props) {
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      const symbol = query.includes(":") ? query.trim().toUpperCase() : `NASDAQ:${query.trim().toUpperCase()}`;
      onSearch(symbol);
      setShowSuggestions(false);
    }
  }, [query, onSearch]);

  return (
    <div className="relative w-full max-w-md">
      <form onSubmit={handleSubmit} className="relative">
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          placeholder="搜尋股票 (e.g. TSLA, 2330)"
          className="w-full pl-4 pr-16 py-2.5 bg-[rgba(15,15,25,0.9)] border border-[rgba(0,240,255,0.3)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--neon-cyan)] focus:shadow-[0_0_15px_rgba(0,240,255,0.2)] transition-all"
        />
        <button type="submit" disabled={loading}
          className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 text-xs bg-[rgba(0,240,255,0.15)] border border-[rgba(0,240,255,0.3)] rounded text-[var(--neon-cyan)] hover:bg-[rgba(0,240,255,0.25)] transition-all disabled:opacity-50">
          {loading ? "⏳" : "搜尋"}
        </button>
      </form>
      {showSuggestions && !loading && (
        <div className="absolute top-full mt-1 w-full glass-card p-2 z-50" onMouseLeave={() => setShowSuggestions(false)}>
          <div className="text-[10px] text-[var(--text-secondary)] mb-1 px-2">熱門股票</div>
          <div className="flex flex-wrap gap-1">
            {POPULAR.map(s => (
              <button key={s} onClick={() => { onSearch(s); setQuery(s); setShowSuggestions(false); }}
                className="px-2 py-1 text-xs bg-[rgba(0,240,255,0.08)] border border-[rgba(0,240,255,0.15)] rounded hover:border-[var(--neon-cyan)] text-[var(--text-secondary)] hover:text-[var(--neon-cyan)] transition-all">
                {s.split(":")[1]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
