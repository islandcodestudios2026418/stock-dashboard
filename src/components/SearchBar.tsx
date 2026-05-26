"use client";
import { useState, useCallback, useRef, useEffect } from "react";

interface Props {
  onSearch: (symbol: string) => void;
  loading?: boolean;
}

interface SearchResult { symbol: string; name: string; exchange: string; type: string; }

const POPULAR = ["NASDAQ:TSLA", "NASDAQ:AAPL", "NASDAQ:NVDA", "NYSE:PLTR", "TWSE:2330", "TWSE:2317", "BINANCE:BTCUSDT", "AMEX:SPY"];

export default function SearchBar({ onSearch, loading }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDrop, setShowDrop] = useState(false);
  const [searching, setSearching] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setShowDrop(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 1) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data);
    } catch { setResults([]); }
    setSearching(false);
  }, []);

  const handleChange = (val: string) => {
    setQuery(val);
    setShowDrop(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val), 300);
  };

  const handleSelect = (symbol: string) => {
    setQuery(symbol);
    setShowDrop(false);
    onSearch(symbol);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      const symbol = query.includes(":") ? query.trim().toUpperCase() : `NASDAQ:${query.trim().toUpperCase()}`;
      handleSelect(symbol);
    }
  };

  return (
    <div className="relative w-full max-w-md" ref={wrapRef}>
      <form onSubmit={handleSubmit} className="relative">
        <input
          type="text"
          value={query}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => setShowDrop(true)}
          placeholder="搜尋股票 (TSLA, 台積電, BTC...)"
          className="w-full pl-4 pr-16 py-2.5 bg-[rgba(15,15,25,0.9)] border border-[rgba(0,240,255,0.3)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--neon-cyan)] focus:shadow-[0_0_15px_rgba(0,240,255,0.2)] transition-all"
        />
        <button type="submit" disabled={loading}
          className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 text-xs bg-[rgba(0,240,255,0.15)] border border-[rgba(0,240,255,0.3)] rounded text-[var(--neon-cyan)] hover:bg-[rgba(0,240,255,0.25)] transition-all disabled:opacity-50">
          {loading ? "⏳" : "搜尋"}
        </button>
      </form>
      {showDrop && (
        <div className="absolute top-full mt-1 w-full glass-card p-2 z-50 max-h-80 overflow-y-auto">
          {searching && <div className="text-xs text-[var(--text-secondary)] px-2 py-1">搜尋中...</div>}
          {results.length > 0 ? (
            <div className="flex flex-col">
              {results.map(r => (
                <button key={r.symbol} onClick={() => handleSelect(r.symbol)}
                  className="flex items-center justify-between px-3 py-2 text-left hover:bg-[rgba(0,240,255,0.08)] rounded transition-all">
                  <div>
                    <span className="text-sm font-medium text-[var(--text-primary)]">{r.symbol.split(":")[1]}</span>
                    <span className="text-xs text-[var(--text-secondary)] ml-2">{r.name}</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-secondary)] border border-[rgba(255,255,255,0.1)] px-1.5 py-0.5 rounded">{r.exchange}</span>
                </button>
              ))}
            </div>
          ) : !searching && query.length === 0 ? (
            <>
              <div className="text-[10px] text-[var(--text-secondary)] mb-1 px-2">熱門股票</div>
              <div className="flex flex-wrap gap-1">
                {POPULAR.map(s => (
                  <button key={s} onClick={() => handleSelect(s)}
                    className="px-2 py-1 text-xs bg-[rgba(0,240,255,0.08)] border border-[rgba(0,240,255,0.15)] rounded hover:border-[var(--neon-cyan)] text-[var(--text-secondary)] hover:text-[var(--neon-cyan)] transition-all">
                    {s.split(":")[1]}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
