import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q") || "";
  if (query.length < 1) return NextResponse.json([]);

  try {
    const TradingView = await import("@mathieuc/tradingview");
    const results = await (TradingView as any).searchMarket(query);
    const top = (results as Array<Record<string, string>>).slice(0, 12).map(r => ({
      symbol: `${r.exchange}:${r.symbol || r.id}`,
      name: r.description,
      exchange: r.exchange,
      type: r.type,
    }));
    return NextResponse.json(top);
  } catch {
    return NextResponse.json([]);
  }
}
