import { NextRequest, NextResponse } from "next/server";

const TV_SESSION = process.env.TRADINGVIEW_SESSION || "";
const TV_SIGNATURE = process.env.TRADINGVIEW_SIGNATURE || "";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") || "NASDAQ:TSLA";
  const tf = req.nextUrl.searchParams.get("timeframe") || "1D";

  try {
    const TradingView = await import("@mathieuc/tradingview");
    const client = new TradingView.Client({ token: TV_SESSION, signature: TV_SIGNATURE });
    const chart = new client.Session.Chart();

    const data = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => { client.end(); reject(new Error("timeout")); }, 15000);

      chart.setMarket(symbol, { timeframe: tf, range: 100 });

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
          periods: periods
            .filter((p: { time?: number; open?: number; close?: number }) => p.time && p.open != null && p.close != null)
            .map((p: { time: number; open: number; high: number; low: number; close: number; volume: number }) => ({
              time: p.time,
              open: +p.open || 0,
              high: +p.high || 0,
              low: +p.low || 0,
              close: +p.close || 0,
              volume: +p.volume || 0,
            }))
            .sort((a: {time:number}, b: {time:number}) => a.time - b.time),
        });
      });

      chart.onError((...args: unknown[]) => {
        clearTimeout(timeout);
        client.end();
        reject(new Error(`Chart error: ${JSON.stringify(args)}`));
      });
    });

    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
