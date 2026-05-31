import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const blocked = apiGuard(req);
  if (blocked) return blocked;

  const symbol = req.nextUrl.searchParams.get("symbol") || "";
  const count = Math.min(Number(req.nextUrl.searchParams.get("count")) || 8, 20);
  if (!symbol) return NextResponse.json({ error: "缺少 symbol 參數", code: "BAD_REQUEST" }, { status: 400 });

  const raw = symbol.includes(":") ? symbol.split(":")[1] : symbol;
  const yahooSymbol = symbol.startsWith("TWSE:") ? `${raw}.TW` : raw;

  try {
    const { default: YahooFinance } = await import("yahoo-finance2");
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"], validation: { logErrors: false } });
    const result: any = await yf.search(yahooSymbol, { newsCount: count }, { validateResult: false });
    const news = (result.news || []).map((n: any) => ({
      title: n.title,
      link: n.link,
      publisher: n.publisher,
      publishedAt: n.providerPublishTime,
    }));
    return NextResponse.json({ symbol: yahooSymbol, news });
  } catch (e) {
    return NextResponse.json({ error: String(e), code: "FETCH_ERROR" }, { status: 500 });
  }
}
