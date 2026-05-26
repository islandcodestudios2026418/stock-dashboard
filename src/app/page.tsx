"use client";
import { useState, useCallback } from "react";
import SearchBar from "@/components/SearchBar";
import CandlestickChart from "@/components/CandlestickChart";
import MarketSnapshot from "@/components/MarketSnapshot";
import IndicatorRadar from "@/components/IndicatorRadar";
import RiskGauge from "@/components/RiskGauge";
import AnalysisPanel from "@/components/AnalysisPanel";
import { OHLCV, getIndicatorSummary, calcRiskScore } from "@/lib/indicators";
import { PriceLevel, TradePlan } from "@/lib/levels";

interface StockData { symbol: string; name: string; periods: OHLCV[]; }

export default function Home() {
  const [data, setData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [timeframe, setTimeframe] = useState("1D");
  const [analysis, setAnalysis] = useState("");
  const [levels, setLevels] = useState<PriceLevel[]>([]);
  const [tradePlan, setTradePlan] = useState<TradePlan | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [lang, setLang] = useState<"zh-TW" | "en">("zh-TW");

  const fetchAnalysis = useCallback(async (stockData: StockData, overrideLang?: string) => {
    setAnalysisLoading(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: stockData.symbol, name: stockData.name, periods: stockData.periods, lang: overrideLang || lang }),
      });
      const json = await res.json();
      setAnalysis(json.analysis || "");
      setLevels(json.levels || []);
      setTradePlan(json.tradePlan || null);
    } catch { setAnalysis(""); }
    finally { setAnalysisLoading(false); }
  }, [lang]);

  const fetchStock = useCallback(async (symbol: string, tf?: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/stock?symbol=${encodeURIComponent(symbol)}&timeframe=${tf || timeframe}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      if (!json.periods?.length) throw new Error("No data returned");
      const stockData = { symbol: json.symbol || symbol, name: json.name || symbol, periods: json.periods };
      setData(stockData);
      fetchAnalysis(stockData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    } finally { setLoading(false); }
  }, [timeframe, fetchAnalysis]);

  const indicators = data && data.periods.length > 20 ? getIndicatorSummary(data.periods) : null;
  const riskScore = data && data.periods.length > 20 ? calcRiskScore(data.periods) : 5;

  return (
    <main className="h-screen flex flex-col p-4 gap-3 overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between shrink-0">
        <h1 className="text-xl font-bold">
          <span className="text-[var(--neon-cyan)]">STOCK</span> ANALYSIS
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={() => { const n = lang === "zh-TW" ? "en" : "zh-TW"; setLang(n); if (data) fetchAnalysis(data, n); }}
            className="px-2.5 py-1 text-xs border border-[rgba(0,240,255,0.3)] rounded text-[var(--text-secondary)] hover:text-[var(--neon-cyan)]">
            {lang === "zh-TW" ? "EN" : "中文"}
          </button>
          <SearchBar onSearch={fetchStock} loading={loading} />
        </div>
      </header>

      {error && <div className="text-sm text-[var(--neon-red)] glass-card px-3 py-2 shrink-0">⚠️ {error}</div>}

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[var(--neon-cyan)] border-t-transparent rounded-full animate-spin" />
          <span className="ml-2 text-[var(--text-secondary)]">載入中...</span>
        </div>
      )}

      {!data && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-5xl mb-3 opacity-20">📈</div>
          <p className="text-base text-[var(--text-secondary)]">搜尋任何股票開始分析</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">支援美股（NASDAQ:TSLA）和台股（TWSE:2330）</p>
        </div>
      )}

      {data && !loading && (
        <div className="flex-1 grid grid-cols-12 gap-3 min-h-0 overflow-hidden">
          {/* LEFT: Snapshot + Indicators */}
          <div className="col-span-2 flex flex-col gap-3 overflow-y-auto">
            <MarketSnapshot data={data.periods} name={data.name} symbol={data.symbol} />
            {indicators && <IndicatorRadar data={indicators} />}
          </div>

          {/* CENTER: Chart (top) + Strategy highlight (bottom) */}
          <div className="col-span-7 flex flex-col gap-3 min-h-0">
            {/* Chart */}
            <div className="glass-card p-3 flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-2 shrink-0">
                <h3 className="text-sm font-semibold text-[var(--neon-cyan)]">K 線圖 — {data.symbol}</h3>
                <div className="flex gap-1">
                  {["1", "5", "15", "60", "1D", "1W"].map(tf => (
                    <button key={tf} onClick={() => { setTimeframe(tf); fetchStock(data.symbol, tf); }}
                      className={`px-2 py-0.5 text-xs rounded ${timeframe === tf
                        ? "bg-[rgba(0,240,255,0.2)] text-[var(--neon-cyan)] border border-[var(--neon-cyan)]"
                        : "text-[var(--text-secondary)] border border-transparent"}`}>
                      {tf}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <CandlestickChart data={data.periods} />
              </div>
            </div>

            {/* STRATEGY HIGHLIGHT - below chart, prominent */}
            {tradePlan && (
              <div className="shrink-0 glass-card p-4 border-[var(--neon-yellow)] border-2 gradient-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-[var(--neon-yellow)]">
                    📋 {lang === "zh-TW" ? "今日操作建議" : "Today's Trade Plan"}
                  </h3>
                  <RiskGauge score={riskScore} />
                </div>
                <div className="grid grid-cols-4 gap-4 mt-3">
                  <div className="text-center">
                    <div className="text-xs text-[var(--text-secondary)] mb-1">{lang === "zh-TW" ? "停損" : "Stop"}</div>
                    <div className="text-lg font-bold font-mono text-[var(--neon-red)]">{tradePlan.stopLoss.toFixed(2)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-[var(--text-secondary)] mb-1">{lang === "zh-TW" ? "進場" : "Entry"}</div>
                    <div className="text-lg font-bold font-mono text-[var(--text-primary)]">{tradePlan.entry.toFixed(2)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-[var(--text-secondary)] mb-1">{lang === "zh-TW" ? "目標1" : "T1"}</div>
                    <div className="text-lg font-bold font-mono text-[var(--neon-green)]">{tradePlan.target1.toFixed(2)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-[var(--text-secondary)] mb-1">{lang === "zh-TW" ? "目標2" : "T2"}</div>
                    <div className="text-lg font-bold font-mono text-[var(--neon-green)]">{tradePlan.target2.toFixed(2)}</div>
                  </div>
                </div>
                <div className="mt-2 text-center text-sm">
                  <span className="text-[var(--text-secondary)]">{lang === "zh-TW" ? "風險報酬比" : "Risk:Reward"} </span>
                  <span className={`font-bold text-base ${tradePlan.riskReward >= 2 ? "text-[var(--neon-green)]" : tradePlan.riskReward >= 1 ? "text-[var(--neon-yellow)]" : "text-[var(--neon-red)]"}`}>
                    1:{tradePlan.riskReward.toFixed(1)} {tradePlan.riskReward >= 2 ? "✅" : tradePlan.riskReward >= 1 ? "⚠️" : "❌"}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Levels + Analysis */}
          <div className="col-span-3 overflow-y-auto min-h-0">
            <AnalysisPanel analysis={analysis} levels={levels} tradePlan={null} loading={analysisLoading} />
          </div>
        </div>
      )}
    </main>
  );
}
