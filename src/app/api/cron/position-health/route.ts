import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/position-health — open position risk check
// Reports: days held, distance to stop, P&L, trailing peak, risk flags.

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

async function getPrice(symbol: string): Promise<number | null> {
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const q = await yf.quote(symbol);
    return q.regularMarketPrice ?? null;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const { data: positions } = await supabase
    .from("portfolio_positions")
    .select("*")
    .eq("status", "open");

  if (!positions || positions.length === 0) {
    return NextResponse.json({ message: "No open positions", positions: [] });
  }

  const health: {
    symbol: string; daysHeld: number; entryPrice: number; currentPrice: number;
    pnlPct: number; pnlDollars: number; distToStop: number; peakPrice: number;
    fromPeak: number; flags: string[];
  }[] = [];

  let totalPnl = 0;

  for (const pos of positions) {
    const raw = pos.symbol.includes(":") ? pos.symbol.split(":")[1] : pos.symbol;
    const yahoo = pos.symbol.startsWith("TWSE:") ? `${raw}.TW` : raw;
    const currentPrice = await getPrice(yahoo);
    if (!currentPrice) continue;

    const daysHeld = Math.floor((Date.now() - new Date(pos.entry_date).getTime()) / 86400000);
    const pnlPct = ((currentPrice - pos.entry_price) / pos.entry_price) * 100;
    const pnlDollars = (currentPrice - pos.entry_price) * pos.shares;
    const peakPrice = Math.max(pos.peak_price || pos.entry_price, currentPrice);
    const fromPeak = ((currentPrice - peakPrice) / peakPrice) * 100;
    const distToStop = pos.stop_loss ? ((currentPrice - pos.stop_loss) / currentPrice) * 100 : 999;

    // Update peak in DB
    if (currentPrice > (pos.peak_price || 0)) {
      await supabase.from("portfolio_positions").update({ peak_price: currentPrice }).eq("id", pos.id);
    }

    const flags: string[] = [];
    if (distToStop < 5) flags.push("🔴 NEAR STOP");
    if (fromPeak < -15) flags.push("⚠️ -15% from peak");
    if (daysHeld > 60 && pnlPct < 5) flags.push("🐌 Stale (60d+ low gain)");
    if (pnlPct < -20) flags.push("💀 Deep loss");
    if (pnlPct > 50) flags.push("🏆 Big winner — consider trailing");

    totalPnl += pnlDollars;
    health.push({
      symbol: raw, daysHeld, entryPrice: pos.entry_price,
      currentPrice: +currentPrice.toFixed(2), pnlPct: +pnlPct.toFixed(1),
      pnlDollars: +pnlDollars.toFixed(2), distToStop: +distToStop.toFixed(1),
      peakPrice: +peakPrice.toFixed(2), fromPeak: +fromPeak.toFixed(1), flags,
    });
  }

  // Sort by risk (closest to stop first)
  health.sort((a, b) => a.distToStop - b.distToStop);
  const critical = health.filter(h => h.flags.length > 0);

  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    positions: health.length,
    totalPnl: +totalPnl.toFixed(2),
    health,
    critical: critical.length,
    summary: critical.length > 0
      ? `⚠️ ${critical.length} position(s) need attention: ${critical.map(c => c.symbol).join(", ")}`
      : `✅ All ${health.length} positions healthy`,
  });
}
