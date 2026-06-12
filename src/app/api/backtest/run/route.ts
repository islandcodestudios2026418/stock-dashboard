import { NextRequest, NextResponse } from "next/server";
import { backtestSymbol, summarizeBacktest, BacktestConfig } from "@/lib/backtest-engine";
import type { OHLCV } from "@/lib/indicators";

// GET /api/backtest/run?symbols=NVDA,TSLA&start=2023-01-01&end=2024-06-01&hold=252
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const symbols = (searchParams.get("symbols") || "NVDA").split(",").slice(0, 5);
  const startDate = searchParams.get("start") || "2023-01-01";
  const endDate = searchParams.get("end") || "2024-06-01";
  const holdingDays = parseInt(searchParams.get("hold") || "252");

  const config: BacktestConfig = { startDate, endDate, lookbackDays: 150, holdingDays };

  const allPicks = [];
  for (const symbol of symbols) {
    try {
      const data = await fetchHistorical(symbol, startDate, endDate, config.lookbackDays);
      const picks = backtestSymbol(symbol, data, config);
      allPicks.push(...picks);
    } catch { /* skip failed symbols */ }
  }

  const summary = summarizeBacktest(allPicks);
  return NextResponse.json({ config, symbols, picks: allPicks, summary });
}

async function fetchHistorical(symbol: string, startDate: string, endDate: string, lookback: number): Promise<OHLCV[]> {
  const mod = await import("yahoo-finance2");
  const YahooFinance = mod.default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const fetchStart = new Date(startDate);
  fetchStart.setDate(fetchStart.getDate() - lookback * 2);

  const result = await yf.chart(symbol, { period1: fetchStart.toISOString().split("T")[0], period2: endDate, interval: "1d" });
  return (result.quotes || [])
    .filter(q => q.open != null && q.close != null)
    .map(q => ({ time: Math.floor(new Date(q.date).getTime() / 1000), open: q.open!, high: q.high!, low: q.low!, close: q.close!, volume: q.volume || 0 }));
}
