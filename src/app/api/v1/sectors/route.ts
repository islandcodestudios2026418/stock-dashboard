import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/api-auth";

const SECTORS = [
  { symbol: "AMEX:XLK", name: "科技", short: "XLK" },
  { symbol: "AMEX:XLF", name: "金融", short: "XLF" },
  { symbol: "AMEX:XLE", name: "能源", short: "XLE" },
  { symbol: "AMEX:XLV", name: "醫療", short: "XLV" },
  { symbol: "AMEX:XLI", name: "工業", short: "XLI" },
  { symbol: "AMEX:XLC", name: "通訊", short: "XLC" },
  { symbol: "AMEX:XLY", name: "消費", short: "XLY" },
  { symbol: "AMEX:XLP", name: "必需", short: "XLP" },
  { symbol: "AMEX:XLU", name: "公用", short: "XLU" },
  { symbol: "AMEX:XLRE", name: "地產", short: "XLRE" },
  { symbol: "AMEX:XLB", name: "材料", short: "XLB" },
];

export async function GET(req: NextRequest) {
  const blocked = apiGuard(req);
  if (blocked) return blocked;

  try {
    const TradingView = await import("@mathieuc/tradingview");
    const client = new TradingView.Client({
      token: process.env.TRADINGVIEW_SESSION || "",
      signature: process.env.TRADINGVIEW_SIGNATURE || "",
    });

    const results: Array<{ symbol: string; name: string; short: string; changePct: number }> = [];

    for (const sector of SECTORS) {
      try {
        const chart = new client.Session.Chart();
        const data = await new Promise<{ changePct: number }>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("timeout")), 8000);
          chart.setMarket(sector.symbol, { timeframe: "1D", range: 2 });
          chart.onUpdate(() => {
            clearTimeout(timeout);
            const periods = chart.periods as unknown as Array<Record<string, number>>;
            const sorted = periods.filter(p => p.close != null).sort((a, b) => a.time - b.time);
            const last = sorted[sorted.length - 1];
            const prev = sorted.length > 1 ? sorted[sorted.length - 2] : last;
            const changePct = prev?.close ? ((last.close - prev.close) / prev.close) * 100 : 0;
            resolve({ changePct });
          });
          chart.onError(() => { clearTimeout(timeout); reject(new Error("err")); });
        });
        results.push({ ...sector, changePct: data.changePct });
      } catch {
        results.push({ ...sector, changePct: 0 });
      }
    }

    client.end();
    return NextResponse.json(results.sort((a, b) => b.changePct - a.changePct));
  } catch (e) {
    return NextResponse.json({ error: String(e), code: "FETCH_ERROR" }, { status: 500 });
  }
}
