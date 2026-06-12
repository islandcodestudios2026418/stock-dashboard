import { NextRequest, NextResponse } from "next/server";
import { type OHLCV, getIndicatorSummary, calcRiskScore } from "@/lib/indicators";
import { runMultiAgentScoring } from "@/lib/multi-agent-scoring";

// GET /api/cron/test?symbol=TSLA
// Quick single-symbol test — no auth, no DB writes, no Discord.
// Use locally: curl http://localhost:3000/api/cron/test?symbol=NVDA

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") || "AAPL";
  const yahooSymbol = symbol.includes(".") ? symbol : symbol.replace(/^TWSE:/, "") + (symbol.startsWith("TWSE:") ? ".TW" : "");
  const raw = symbol.includes(":") ? symbol : `NASDAQ:${symbol}`;

  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const period1 = new Date(Date.now() - 150 * 86400000).toISOString().split("T")[0];
    const result = await yf.chart(yahooSymbol.replace(/^NASDAQ:|^NYSE:/i, ""), { period1, interval: "1d" });

    const periods: OHLCV[] = (result.quotes || [])
      .filter(q => q.open != null && q.close != null)
      .map(q => ({ time: Math.floor(new Date(q.date).getTime() / 1000), open: q.open!, high: q.high!, low: q.low!, close: q.close!, volume: q.volume || 0 }));

    if (periods.length < 20) return NextResponse.json({ error: "Insufficient data", bars: periods.length }, { status: 400 });

    const scoring = runMultiAgentScoring(raw, periods);
    const indicators = getIndicatorSummary(periods);
    const risk = calcRiskScore(periods);
    const last = periods[periods.length - 1];

    return NextResponse.json({
      symbol: raw, price: last.close, bars: periods.length,
      scoring: { consensus: scoring.consensus, avgScore: scoring.avgScore, recommendation: scoring.recommendation, agents: scoring.agents },
      indicators: { rsi: indicators.rsi.value, macd: indicators.macd, ma: indicators.ma.status },
      risk,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
