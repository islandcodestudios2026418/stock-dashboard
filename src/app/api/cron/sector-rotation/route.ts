import { NextRequest, NextResponse } from "next/server";

// GET /api/cron/sector-rotation — ranks sectors by momentum, detects rotation
// Uses SPDR sector ETFs as proxy for sector health

const CRON_SECRET = process.env.CRON_SECRET || "";

const SECTOR_ETFS: Record<string, string> = {
  XLK: "Technology", XLV: "Healthcare", XLF: "Financials",
  XLE: "Energy", XLI: "Industrials", XLY: "Consumer Discretionary",
  XLP: "Consumer Staples", XLU: "Utilities", XLB: "Materials",
  XLRE: "Real Estate", XLC: "Communication Services",
};

// Stock → sector mapping (common watchlist stocks)
export const STOCK_SECTORS: Record<string, string> = {
  NVDA: "XLK", AAPL: "XLK", MSFT: "XLK", AMD: "XLK", SMCI: "XLK",
  TSLA: "XLY", AMZN: "XLY",
  META: "XLC", GOOG: "XLC", GOOGL: "XLC", NFLX: "XLC",
  JPM: "XLF", GS: "XLF", BAC: "XLF",
  XOM: "XLE", CVX: "XLE",
  JNJ: "XLV", UNH: "XLV", LLY: "XLV",
  ENPH: "XLK", CELH: "XLP",
};

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

interface SectorData {
  etf: string;
  sector: string;
  momentum20d: number;
  momentum5d: number;
  rank: number;
  trend: "accelerating" | "decelerating" | "stable";
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mod = await import("yahoo-finance2");
  const YahooFinance = mod.default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const period1 = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

  const sectors: SectorData[] = [];

  for (const [etf, sector] of Object.entries(SECTOR_ETFS)) {
    try {
      const result = await yf.chart(etf, { period1, interval: "1d" });
      const quotes = (result.quotes || []).filter(q => q.close != null);
      if (quotes.length < 20) continue;

      const closes = quotes.map(q => q.close!);
      const current = closes[closes.length - 1];
      const d20 = closes[closes.length - 21] || closes[0];
      const d5 = closes[closes.length - 6] || closes[0];

      const momentum20d = ((current - d20) / d20) * 100;
      const momentum5d = ((current - d5) / d5) * 100;

      // Trend: is 5d momentum > 20d momentum scaled to same period?
      const scaled20to5 = momentum20d / 4; // rough scaling
      const trend = momentum5d > scaled20to5 + 0.5 ? "accelerating" : momentum5d < scaled20to5 - 0.5 ? "decelerating" : "stable";

      sectors.push({ etf, sector, momentum20d: Math.round(momentum20d * 100) / 100, momentum5d: Math.round(momentum5d * 100) / 100, rank: 0, trend });
    } catch { continue; }
  }

  // Rank by 20d momentum
  sectors.sort((a, b) => b.momentum20d - a.momentum20d);
  sectors.forEach((s, i) => s.rank = i + 1);

  // Detect rotation: strong short-term divergence from long-term
  const rotationSignals = sectors.filter(s => s.trend === "accelerating" && s.rank > 5)
    .map(s => `${s.sector} (${s.etf}) rising from #${s.rank}`);

  const topSectors = sectors.slice(0, 3).map(s => s.sector);

  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    sectors,
    topSectors,
    rotationSignals,
    summary: rotationSignals.length > 0
      ? `🔄 Rotation detected: ${rotationSignals.join(", ")}`
      : `📊 Leadership: ${topSectors.join(", ")}`,
  });
}
