"use client";
import { useState, useCallback } from "react";
import SearchBar from "@/components/SearchBar";
import CandlestickChart from "@/components/CandlestickChart";
import MarketSnapshot from "@/components/MarketSnapshot";
import IndicatorRadar from "@/components/IndicatorRadar";
import RiskGauge from "@/components/RiskGauge";
import { OHLCV, getIndicatorSummary, calcRiskScore } from "@/lib/indicators";

interface StockData {
  symbol: string;
  name: string;
  periods: OHLCV[];
}

export default function Home() {
  const [data, setData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [timeframe, setTimeframe] = useState("1D");

  const fetchStock = useCallback(async (symbol: string, tf?: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/stock?symbol=${encodeURIComponent(symbol)}&timeframe=${tf || timeframe}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData({ symbol: json.symbol || symbol, name: json.name || symbol, periods: json.periods });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [timeframe]);

  const indicators = data && data.periods.length > 20 ? getIndicatorSummary(data.periods) : null;
  const riskScore = data && data.periods.length > 20 ? calcRiskScore(data.periods) : 5;

  return (
    <main className="min-h-screen p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            <span className="text-[var(--neon-cyan)] neon-text">STOCK</span>
            <span className="text-[var(--text-primary)]"> ANALYSIS</span>
          </h1>
          <p className="text-xs text-[var(--text-secondary)]">互動式技術面分析儀表板</p>
        </div>
        <SearchBar onSearch={fetchStock} loading={loading} />
      </header>

      {/* Error */}
      {error && (
        <div className="glass-card p-3 mb-4 border-[var(--neon-red)] text-[var(--neon-red)] text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-[var(--neon-cyan)] border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-[var(--text-secondary)]">載入中...</span>
        </div>
      )}

      {/* Dashboard */}
      {data && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Market Snapshot - left column */}
          <div className="lg:col-span-1">
            <MarketSnapshot data={data.periods} name={data.name} symbol={data.symbol} />
          </div>

          {/* Chart - main area */}
          <div className="lg:col-span-3">
            <div className="glass-card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[var(--neon-cyan)]">
                  K 線圖 — {data.symbol}
                </h3>
                <div className="flex gap-1">
                  {["1", "5", "15", "60", "1D", "1W"].map(tf => (
                    <button key={tf} onClick={() => { setTimeframe(tf); fetchStock(data.symbol, tf); }}
                      className={`px-2 py-0.5 text-xs rounded transition-all ${timeframe === tf
                        ? "bg-[rgba(0,240,255,0.2)] text-[var(--neon-cyan)] border border-[var(--neon-cyan)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent"}`}>
                      {tf}
                    </button>
                  ))}
                </div>
              </div>
              <CandlestickChart data={data.periods} />
            </div>
          </div>

          {/* Indicator Radar */}
          <div className="lg:col-span-2">
            {indicators && <IndicatorRadar data={indicators} />}
          </div>

          {/* Risk Gauge */}
          <div className="lg:col-span-1">
            <RiskGauge score={riskScore} />
          </div>

          {/* AI Analysis placeholder */}
          <div className="lg:col-span-1">
            <div className="glass-card p-4 h-full">
              <h3 className="text-sm font-semibold mb-2 text-[var(--neon-cyan)]">AI 行情分析</h3>
              <p className="text-xs text-[var(--text-secondary)]">即將推出 — Claude AI 自動生成技術面分析（中/英文）</p>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!data && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-6xl mb-4 opacity-20">📈</div>
          <h2 className="text-lg font-semibold text-[var(--text-secondary)]">搜尋任何股票開始分析</h2>
          <p className="text-xs text-[var(--text-secondary)] mt-1">支援美股（NASDAQ:TSLA）和台股（TWSE:2330）</p>
        </div>
      )}
    </main>
  );
}
