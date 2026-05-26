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
        </div>
      )}

      {!data && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-5xl mb-3 opacity-20">📈</div>
          <p className="text-base text-[var(--text-secondary)]">搜尋任何股票開始分析</p>
        </div>
      )}

      {data && !loading && (
        <div className="flex-1 grid grid-cols-12 grid-rows-[1fr_auto] gap-3 min-h-0 overflow-hidden">

          {/* LEFT COL: Snapshot + Radar */}
          <div className="col-span-2 row-span-2 flex flex-col gap-3 overflow-y-auto min-h-0">
            <MarketSnapshot data={data.periods} name={data.name} symbol={data.symbol} />
            {indicators && <IndicatorRadar data={indicators} />}
          </div>

          {/* CENTER: Chart - takes most vertical space */}
          <div className="col-span-7 row-span-1 glass-card p-3 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-1 shrink-0">
              <h3 className="text-sm font-semibold text-[var(--neon-cyan)]">{data.symbol}</h3>
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

          {/* RIGHT COL: Analysis - scrollable */}
          <div className="col-span-3 row-span-2 overflow-y-auto min-h-0">
            <AnalysisPanel analysis={analysis} levels={levels} tradePlan={tradePlan} loading={analysisLoading} />
          </div>

          {/* BOTTOM CENTER: Trade Plan - compact single row */}
          <div className="col-span-7 row-span-1 shrink-0">
            {tradePlan && (
              <div className="glass-card px-4 py-2 border border-[var(--neon-yellow)] flex items-center justify-between gap-4">
                <span className="text-sm font-bold text-[var(--neon-yellow)] whitespace-nowrap">📋 {lang === "zh-TW" ? "操作建議" : "Trade Plan"}</span>
                <div className="flex items-center gap-5 text-sm font-mono">
                  <span><span className="text-[var(--text-secondary)] text-xs mr-1">{lang === "zh-TW" ? "停損" : "Stop"}</span><span className="text-[var(--neon-red)] font-bold">{tradePlan.stopLoss.toFixed(2)}</span></span>
                  <span><span className="text-[var(--text-secondary)] text-xs mr-1">{lang === "zh-TW" ? "進場" : "Entry"}</span><span className="font-bold">{tradePlan.entry.toFixed(2)}</span></span>
                  <span><span className="text-[var(--text-secondary)] text-xs mr-1">T1</span><span className="text-[var(--neon-green)] font-bold">{tradePlan.target1.toFixed(2)}</span></span>
                  <span><span className="text-[var(--text-secondary)] text-xs mr-1">T2</span><span className="text-[var(--neon-green)] font-bold">{tradePlan.target2.toFixed(2)}</span></span>
                  <span><span className="text-[var(--text-secondary)] text-xs mr-1">R:R</span><span className={`font-bold ${tradePlan.riskReward >= 2 ? "text-[var(--neon-green)]" : tradePlan.riskReward >= 1 ? "text-[var(--neon-yellow)]" : "text-[var(--neon-red)]"}`}>1:{tradePlan.riskReward.toFixed(1)}</span></span>
                </div>
                <RiskGauge score={riskScore} />
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
