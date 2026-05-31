import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const blocked = apiGuard(req);
  if (blocked) return blocked;

  const symbol = req.nextUrl.searchParams.get("symbol") || "";
  if (!symbol) return NextResponse.json({ error: "缺少 symbol 參數", code: "BAD_REQUEST" }, { status: 400 });

  const raw = symbol.includes(":") ? symbol.split(":")[1] : symbol;
  const yahooSymbol = symbol.startsWith("TWSE:") ? `${raw}.TW` : raw;

  try {
    const { default: YahooFinance } = await import("yahoo-finance2");
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"], validation: { logErrors: false } });
    const data: any = await yf.quoteSummary(yahooSymbol, {
      modules: ["price", "summaryDetail", "defaultKeyStatistics", "financialData"],
    });

    const price = data.price;
    const summary = data.summaryDetail;
    const stats = data.defaultKeyStatistics;
    const financial = data.financialData;

    return NextResponse.json({
      symbol: yahooSymbol,
      name: price?.shortName || price?.longName || yahooSymbol,
      price: price?.regularMarketPrice,
      change: price?.regularMarketChange,
      changePercent: price?.regularMarketChangePercent,
      marketCap: price?.marketCap,
      pe: summary?.trailingPE,
      forwardPe: summary?.forwardPE,
      pb: summary?.priceToBook,
      eps: stats?.trailingEps,
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
    return NextResponse.json({ error: String(e), code: "FETCH_ERROR" }, { status: 500 });
  }
}
