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

  const t = lang === "zh-TW"
    ? { title: "STOCK ANALYSIS", sub: "互動式技術面分析儀表板", search: "搜尋任何股票開始分析", support: "支援美股（NASDAQ:TSLA）和台股（TWSE:2330）", loading: "載入中...", chart: "K 線圖", err: "錯誤" }
    : { title: "STOCK ANALYSIS", sub: "Interactive Technical Analysis Dashboard", search: "Search any stock to begin", support: "US stocks (NASDAQ:TSLA) and TW stocks (TWSE:2330)", loading: "Loading...", chart: "Chart", err: "Error" };

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
    <main className="h-screen flex flex-col p-3 gap-3 overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-bold tracking-tight leading-none">
            <span className="text-[var(--neon-cyan)]">STOCK</span> ANALYSIS
          </h1>
          <p className="text-[10px] text-[var(--text-secondary)]">{t.sub}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => {
            const newLang = lang === "zh-TW" ? "en" : "zh-TW";
            setLang(newLang);
            if (data) fetchAnalysis(data, newLang);
          }} className="px-2 py-1 text-[10px] border border-[rgba(0,240,255,0.3)] rounded text-[var(--text-secondary)] hover:text-[var(--neon-cyan)] transition-all">
            {lang === "zh-TW" ? "EN" : "中文"}
          </button>
          <SearchBar onSearch={fetchStock} loading={loading} />
        </div>
      </header>

      {error && <div className="text-xs text-[var(--neon-red)] glass-card px-3 py-1.5 shrink-0">⚠️ {error}</div>}

      {/* Loading */}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[var(--neon-cyan)] border-t-transparent rounded-full animate-spin" />
          <span className="ml-2 text-sm text-[var(--text-secondary)]">{t.loading}</span>
        </div>
      )}

      {/* Empty state */}
      {!data && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-5xl mb-3 opacity-20">📈</div>
          <p className="text-sm text-[var(--text-secondary)]">{t.search}</p>
          <p className="text-[10px] text-[var(--text-secondary)] mt-1">{t.support}</p>
        </div>
      )}

      {/* Dashboard - fills remaining space, NO scroll */}
      {data && !loading && (
        <div className="flex-1 grid grid-cols-12 grid-rows-[auto_1fr] gap-3 min-h-0">
          {/* Row 1: Snapshot + Chart + Risk */}
          <div className="col-span-2 row-span-2 flex flex-col gap-3 overflow-hidden">
            <MarketSnapshot data={data.periods} name={data.name} symbol={data.symbol} />
            {indicators && <IndicatorRadar data={indicators} />}
            <RiskGauge score={riskScore} />
          </div>

          <div className="col-span-7 glass-card p-3 min-h-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-[var(--neon-cyan)]">{t.chart} — {data.symbol}</h3>
              <div className="flex gap-0.5">
                {["1", "5", "15", "60", "1D", "1W"].map(tf => (
                  <button key={tf} onClick={() => { setTimeframe(tf); fetchStock(data.symbol, tf); }}
                    className={`px-1.5 py-0.5 text-[10px] rounded ${timeframe === tf
                      ? "bg-[rgba(0,240,255,0.2)] text-[var(--neon-cyan)] border border-[var(--neon-cyan)]"
                      : "text-[var(--text-secondary)] border border-transparent hover:text-[var(--text-primary)]"}`}>
                    {tf}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-[calc(100%-2rem)]">
              <CandlestickChart data={data.periods} />
            </div>
          </div>

          <div className="col-span-3 row-span-2 overflow-y-auto min-h-0">
            <AnalysisPanel analysis={analysis} levels={levels} tradePlan={tradePlan} loading={analysisLoading} />
          </div>
        </div>
      )}
    </main>
  );
}
