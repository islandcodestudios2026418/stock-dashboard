import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const blocked = apiGuard(req);
  if (blocked) return blocked;

  const symbol = req.nextUrl.searchParams.get("symbol") || "";
  const tf = req.nextUrl.searchParams.get("timeframe") || "1D";
  const range = Math.min(Number(req.nextUrl.searchParams.get("range")) || 300, 500);

  if (!symbol) return NextResponse.json({ error: "缺少 symbol 參數", code: "BAD_REQUEST" }, { status: 400 });

  try {
    const TradingView = await import("@mathieuc/tradingview");
    const client = new TradingView.Client({
      token: process.env.TRADINGVIEW_SESSION || "",
      signature: process.env.TRADINGVIEW_SIGNATURE || "",
    });
    const chart = new client.Session.Chart();

    const data = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => { client.end(); reject(new Error("timeout")); }, 15000);
      chart.setMarket(symbol, { timeframe: tf, range });
      chart.onUpdate(() => {
        clearTimeout(timeout);
        const periods = chart.periods;
        const info = chart.infos;
        client.end();
        resolve({
          symbol: info?.full_name || symbol,
          name: info?.short_description || info?.description || symbol,
          exchange: info?.listed_exchange || "",
          currency: info?.currency_id || "USD",
          periods: (periods as unknown as Array<Record<string, number>>)
            .filter(p => p.time && p.open != null && p.close != null)
            .map(p => ({
              time: +p.time,
              open: +p.open || 0,
              high: +(p.max || p.high) || 0,
              low: +(p.min || p.low) || 0,
              close: +p.close || 0,
              volume: +p.volume || 0,
            }))
            .filter(p => p.high > 0 && p.low > 0 && p.open > 0)
            .sort((a, b) => a.time - b.time),
        });
      });
      chart.onError((...args: unknown[]) => {
        clearTimeout(timeout);
        client.end();
        reject(new Error(`Chart error: ${JSON.stringify(args)}`));
      });
    });

    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg, code: "FETCH_ERROR" }, { status: 500 });
  }
}
