import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") || "";
  if (!symbol) return NextResponse.json({ error: "No symbol" }, { status: 400 });

  const raw = symbol.includes(":") ? symbol.split(":")[1] : symbol;
  const yahooSymbol = symbol.startsWith("TWSE:") ? `${raw}.TW` : raw;

  try {
    const yahooFinance = (await import("yahoo-finance2")).default;
    const result: any = await yahooFinance.search(yahooSymbol, { newsCount: 8 });
    const news = (result.news || []).map((n: any) => ({
      title: n.title,
      link: n.link,
      publisher: n.publisher,
      publishedAt: n.providerPublishTime,
    }));
    return NextResponse.json(news);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
