import { NextResponse } from "next/server";

const MACRO_SYMBOLS = [
  { key: "vix", symbol: "CBOE:VIX", name: "VIX" },
  { key: "dxy", symbol: "TVC:DXY", name: "美元指數" },
  { key: "us10y", symbol: "TVC:US10Y", name: "美10年債" },
  { key: "us02y", symbol: "TVC:US02Y", name: "美2年債" },
  { key: "spx", symbol: "SP:SPX", name: "S&P 500" },
  { key: "gold", symbol: "TVC:GOLD", name: "黃金" },
];

export async function GET() {
  try {
    const TradingView = await import("@mathieuc/tradingview");
    const client = new TradingView.Client({
      token: process.env.TRADINGVIEW_SESSION || "",
      signature: process.env.TRADINGVIEW_SIGNATURE || "",
    });

    const results: Record<string, { price: number; change: number; changePct: number; name: string }> = {};

    // Fetch each symbol sequentially (TradingView client limitation)
    for (const item of MACRO_SYMBOLS) {
      try {
        const chart = new client.Session.Chart();
        const data = await new Promise<{ close: number; prevClose: number }>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("timeout")), 8000);
          chart.setMarket(item.symbol, { timeframe: "1D", range: 2 });
          chart.onUpdate(() => {
            clearTimeout(timeout);
            const periods = chart.periods as unknown as Array<Record<string, number>>;
            const sorted = periods.filter(p => p.close != null).sort((a, b) => a.time - b.time);
            const last = sorted[sorted.length - 1];
            const prev = sorted.length > 1 ? sorted[sorted.length - 2] : last;
            resolve({ close: last?.close || 0, prevClose: prev?.close || last?.close || 0 });
          });
          chart.onError(() => { clearTimeout(timeout); reject(new Error("chart error")); });
        });
        const change = data.close - data.prevClose;
        const changePct = data.prevClose ? (change / data.prevClose) * 100 : 0;
        results[item.key] = { price: data.close, change, changePct, name: item.name };
      } catch {
        results[item.key] = { price: 0, change: 0, changePct: 0, name: item.name };
      }
    }

    client.end();
    return NextResponse.json(results);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
