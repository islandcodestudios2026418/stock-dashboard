import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") || "";
  if (!symbol) return NextResponse.json({ error: "No symbol" }, { status: 400 });

  const raw = symbol.includes(":") ? symbol.split(":")[1] : symbol;
  const yahooSymbol = symbol.startsWith("TWSE:") ? `${raw}.TW` : raw;

  try {
    const { default: YahooFinance } = await import("yahoo-finance2");
    const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const data: any = await yahooFinance.quoteSummary(yahooSymbol, {
      modules: ["price", "summaryDetail", "defaultKeyStatistics", "financialData"],
    });

    const price = data.price;
    const summary = data.summaryDetail;
    const stats = data.defaultKeyStatistics;
    const financial = data.financialData;

    return NextResponse.json({
      symbol: yahooSymbol,
      name: price?.shortName || price?.longName || yahooSymbol,
      marketCap: price?.marketCap,
      pe: summary?.trailingPE ?? stats?.trailingEps ? (price?.regularMarketPrice ?? 0) / (stats?.trailingEps ?? 1) : null,
      forwardPe: summary?.forwardPE,
      pb: summary?.priceToBook,
      eps: stats?.trailingEps,
      forwardEps: stats?.forwardEps,
      revenue: financial?.totalRevenue,
      revenueGrowth: financial?.revenueGrowth,
      profitMargin: financial?.profitMargins,
      roe: financial?.returnOnEquity,
      debtToEquity: financial?.debtToEquity,
      dividendYield: summary?.dividendYield,
      beta: summary?.beta,
      fiftyTwoWeekHigh: summary?.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: summary?.fiftyTwoWeekLow,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
