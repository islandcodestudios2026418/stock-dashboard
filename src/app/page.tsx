"use client";
import { useState, useCallback } from "react";
import SearchBar from "@/components/SearchBar";
import CandlestickChart from "@/components/CandlestickChart";
import MarketSnapshot from "@/components/MarketSnapshot";
import IndicatorRadar from "@/components/IndicatorRadar";
import RiskGauge from "@/components/RiskGauge";
import AnalysisPanel from "@/components/AnalysisPanel";
import MacroPanel from "@/components/MacroPanel";
import SectorHeatmap from "@/components/SectorHeatmap";
import Watchlist from "@/components/Watchlist";
import FundamentalsPanel from "@/components/FundamentalsPanel";
import NewsPanel from "@/components/NewsPanel";
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
    <main className="min-h-screen flex flex-col p-4 gap-3">
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
          <Watchlist onSelect={fetchStock} currentSymbol={data?.symbol} />
          <SearchBar onSearch={fetchStock} loading={loading} />
        </div>
      </header>

      {error && <div className="text-sm text-[var(--neon-red)] glass-card px-3 py-2 shrink-0">⚠️ {error}</div>}

      {/* Macro overview - always visible */}
      <MacroPanel lang={lang} />
      <SectorHeatmap lang={lang} />

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[var(--neon-cyan)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!data && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-5xl mb-3 opacity-20">📈</div>
          <p className="text-base text-[var(--text-secondary)]">{lang === "en" ? "Search any stock to begin analysis" : "\u641C\u5C0B\u4EFB\u4F55\u80A1\u7968\u958B\u59CB\u5206\u6790"}</p>
        </div>
      )}

      {data && !loading && (
        <div className="flex-1 grid grid-cols-12 grid-rows-[420px_1fr] gap-3 min-h-[700px]">

          {/* TOP-LEFT: Snapshot */}
          <div className="col-span-2 row-span-1 overflow-y-auto">
            <MarketSnapshot data={data.periods} name={data.name} symbol={data.symbol} lang={lang} />
          </div>

          {/* TOP-CENTER: Chart */}
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

          {/* TOP-RIGHT: Trade Plan + Levels */}
          <div className="col-span-3 row-span-1 flex flex-col gap-2 overflow-y-auto">
            {/* Trade Plan - prominent */}
            {tradePlan && (
              <div className="glass-card p-3 border border-[var(--neon-yellow)]">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-[var(--neon-yellow)]">📋 {lang === "zh-TW" ? "操作建議" : "Trade Plan"}</h3>
                  <RiskGauge score={riskScore} lang={lang} />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-[var(--text-secondary)]">{lang === "en" ? "Stop" : "\u505C\u640D"}</span><span className="font-mono font-bold text-[var(--neon-red)]">{tradePlan.stopLoss.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--text-secondary)]">{lang === "en" ? "Entry" : "\u9032\u5834"}</span><span className="font-mono font-bold">{tradePlan.entry.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--text-secondary)]">{lang === "en" ? "Target1" : "\u76EE\u6A191"}</span><span className="font-mono font-bold text-[var(--neon-green)]">{tradePlan.target1.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--text-secondary)]">{lang === "en" ? "Target2" : "\u76EE\u6A192"}</span><span className="font-mono font-bold text-[var(--neon-green)]">{tradePlan.target2.toFixed(2)}</span></div>
                </div>
                <div className="mt-1.5 text-sm text-center">
                  <span className="text-[var(--text-secondary)]">R:R </span>
                  <span className={`font-bold ${tradePlan.riskReward >= 2 ? "text-[var(--neon-green)]" : tradePlan.riskReward >= 1 ? "text-[var(--neon-yellow)]" : "text-[var(--neon-red)]"}`}>
                    1:{tradePlan.riskReward.toFixed(1)} {tradePlan.riskReward >= 2 ? "✅" : tradePlan.riskReward >= 1 ? "⚠️" : "❌"}
                  </span>
                </div>
              </div>
            )}
            {/* Levels */}
            <div className="glass-card p-3">
              <h3 className="text-sm font-bold text-[var(--neon-cyan)] mb-2">{lang === "en" ? "Key Levels" : "\u95DC\u9375\u50F9\u4F4D"}</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-[var(--neon-red)] font-medium mb-1">{lang === "en" ? "Resist \u25B2" : "\u58D3\u529B \u25B2"}</div>
                  {levels.filter(l => l.type === "resistance").slice(0, 3).map((l, i) => (
                    <div key={i} className="text-sm font-mono py-0.5">{l.price.toFixed(2)}</div>
                  ))}
                </div>
                <div>
                  <div className="text-xs text-[var(--neon-green)] font-medium mb-1">{lang === "en" ? "Support \u25BC" : "\u652F\u6490 \u25BC"}</div>
                  {levels.filter(l => l.type === "support").slice(0, 3).map((l, i) => (
                    <div key={i} className="text-sm font-mono py-0.5">{l.price.toFixed(2)}</div>
                  ))}
                </div>
              </div>
            </div>
            {/* Fundamentals */}
            <FundamentalsPanel symbol={data.symbol} lang={lang} />
            {/* News */}
            <NewsPanel symbol={data.symbol} lang={lang} />
          </div>

          {/* BOTTOM-LEFT: Indicator Radar */}
          <div className="col-span-2 row-span-1 overflow-hidden">
            {indicators && <IndicatorRadar data={indicators} lang={lang} />}
          </div>

          {/* BOTTOM-CENTER + RIGHT: Analysis cards in horizontal flow */}
          <div className="col-span-10 row-span-1 min-h-0 overflow-hidden">
            <AnalysisPanel analysis={analysis} levels={[]} tradePlan={null} loading={analysisLoading} />
          </div>
        </div>
      )}
    </main>
  );
}
