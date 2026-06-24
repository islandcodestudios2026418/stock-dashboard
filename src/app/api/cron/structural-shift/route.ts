import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";
import { STOCK_SECTORS, SECTOR_NAMES } from "@/lib/sector-classification";

// GET /api/cron/structural-shift — THE core SNDK-finder signal
// Detects: stock massively outperforming its sector (structural shift pattern)
// SNDK pattern: mature company + industry shift + supply-demand imbalance = 3500% in 1yr
// Signals: stock 2x+ sector return over 60d AND breaking out of long base AND volume surge

const CRON_SECRET = process.env.CRON_SECRET || "";
const OUTPERFORMANCE_THRESHOLD = 2.0; // stock must return 2x its sector ETF
const BASE_DAYS = 120; // look for 120-day consolidation base
const BREAKOUT_THRESHOLD = 0.05; // 5% above base high = breakout
const VOLUME_SURGE_THRESHOLD = 1.5; // 50% above average volume

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

interface ShiftSignal {
  symbol: string;
  sector: string;
  stockReturn60d: number;
  sectorReturn60d: number;
  outperformanceRatio: number;
  isBreakingOut: boolean;
  volumeSurge: boolean;
  baseLength: number;
  shiftScore: number; // 0-100, higher = more like SNDK
  reasoning: string;
}

async function fetchData(symbol: string, days: number): Promise<{ closes: number[]; volumes: number[]; highs: number[] } | null> {
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const period1 = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
    const result = await yf.chart(symbol, { period1, interval: "1d" });
    const quotes = (result.quotes || []).filter(q => q.close != null);
    return {
      closes: quotes.map(q => q.close!),
      volumes: quotes.map(q => q.volume || 0),
      highs: quotes.map(q => q.high || q.close!),
    };
  } catch { return null; }
}

function detectBase(highs: number[], closes: number[]): { baseLength: number; breakingOut: boolean } {
  // Find how long the stock has been in a consolidation range (base)
  // Base = price stays within 25% range for extended period
  const current = closes[closes.length - 1];
  const recentHigh = Math.max(...highs.slice(-BASE_DAYS));
  const recentLow = Math.min(...closes.slice(-BASE_DAYS));
  const range = (recentHigh - recentLow) / recentLow;

  // Count days price was within the range (base length)
  let baseLength = 0;
  for (let i = closes.length - 1; i >= Math.max(0, closes.length - BASE_DAYS); i--) {
    if (closes[i] >= recentLow * 0.95 && closes[i] <= recentHigh * 1.05) baseLength++;
    else break;
  }

  // Breakout: current price > base high + threshold
  const breakingOut = current > recentHigh * (1 + BREAKOUT_THRESHOLD) && range < 0.30;

  return { baseLength, breakingOut };
}

function detectVolumeSurge(volumes: number[]): boolean {
  if (volumes.length < 30) return false;
  const recent5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const avg60 = volumes.slice(-60).reduce((a, b) => a + b, 0) / Math.min(60, volumes.length);
  return recent5 > avg60 * VOLUME_SURGE_THRESHOLD;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = trySupabase();
  let symbols: string[];
  if (supabase) {
    const { data } = await supabase.from("watchlists").select("symbol").eq("active", true);
    symbols = (data || []).map((r: { symbol: string }) => r.symbol);
  } else {
    symbols = (process.env.WATCHLIST || "NASDAQ:NVDA,NASDAQ:TSLA,NASDAQ:AAPL").split(",");
  }

  // Cache sector ETF data
  const sectorCache: Record<string, number> = {};

  const signals: ShiftSignal[] = [];

  for (const symbol of symbols) {
    const raw = symbol.includes(":") ? symbol.split(":")[1] : symbol;
    const yahooSymbol = symbol.startsWith("TWSE:") ? `${raw}.TW` : raw;
    const sectorEtf = STOCK_SECTORS[raw];
    if (!sectorEtf) continue; // skip if no sector mapping

    // Fetch stock data (150 days for base detection)
    const stockData = await fetchData(yahooSymbol, 150);
    if (!stockData || stockData.closes.length < 60) continue;

    // Fetch sector ETF data (cached)
    if (!(sectorEtf in sectorCache)) {
      const sectorData = await fetchData(sectorEtf, 60);
      if (sectorData && sectorData.closes.length >= 30) {
        const first = sectorData.closes[0];
        const last = sectorData.closes[sectorData.closes.length - 1];
        sectorCache[sectorEtf] = ((last - first) / first) * 100;
      } else {
        sectorCache[sectorEtf] = 0;
      }
    }

    const sectorReturn = sectorCache[sectorEtf];
    const stockCloses = stockData.closes;
    const c60ago = stockCloses[Math.max(0, stockCloses.length - 61)];
    const cLast = stockCloses[stockCloses.length - 1];
    const stockReturn = ((cLast - c60ago) / c60ago) * 100;

    // Outperformance ratio
    const outperformance = sectorReturn !== 0 ? stockReturn / Math.abs(sectorReturn) : stockReturn > 5 ? 3 : 1;

    // Base detection
    const { baseLength, breakingOut } = detectBase(stockData.highs, stockCloses);

    // Volume surge
    const volumeSurge = detectVolumeSurge(stockData.volumes);

    // Compute shift score
    let shiftScore = 0;
    const reasons: string[] = [];

    // Outperformance (max 40 pts)
    if (outperformance >= OUTPERFORMANCE_THRESHOLD) {
      shiftScore += Math.min(40, Math.round(outperformance * 10));
      reasons.push(`Outperforms sector ${outperformance.toFixed(1)}x`);
    }

    // Breakout from base (max 30 pts)
    if (breakingOut) {
      shiftScore += 30;
      reasons.push(`Breaking ${baseLength}d base`);
    } else if (baseLength >= 60) {
      shiftScore += 10;
      reasons.push(`Forming ${baseLength}d base`);
    }

    // Volume surge (max 20 pts)
    if (volumeSurge) {
      shiftScore += 20;
      reasons.push("Volume surge (institutional)");
    }

    // Sector tailwind bonus (10 pts if sector also positive)
    if (sectorReturn > 5) {
      shiftScore += 10;
      reasons.push("Sector tailwind");
    }

    shiftScore = Math.min(100, shiftScore);

    if (shiftScore >= 30) { // Only report meaningful signals
      signals.push({
        symbol,
        sector: SECTOR_NAMES[sectorEtf] || sectorEtf,
        stockReturn60d: Math.round(stockReturn * 100) / 100,
        sectorReturn60d: Math.round(sectorReturn * 100) / 100,
        outperformanceRatio: Math.round(outperformance * 100) / 100,
        isBreakingOut: breakingOut,
        volumeSurge,
        baseLength,
        shiftScore,
        reasoning: reasons.join(" + "),
      });
    }
  }

  // Sort by shift score
  signals.sort((a, b) => b.shiftScore - a.shiftScore);

  // Notify if high-score signals found
  const highSignals = signals.filter(s => s.shiftScore >= 70);
  if (highSignals.length > 0) {
    const msg = `🏭 <b>STRUCTURAL SHIFT DETECTED</b>\n\n${highSignals.map(s => `🔥 ${s.symbol} — shift score ${s.shiftScore}/100\n  ${s.reasoning}\n  Stock: +${s.stockReturn60d}% vs Sector: +${s.sectorReturn60d}%`).join("\n\n")}`;
    await notifyTelegram(msg);
  }

  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    signals,
    highPriority: highSignals.map(s => s.symbol),
    summary: highSignals.length > 0
      ? `🏭 Structural shift: ${highSignals.map(s => s.symbol).join(", ")}`
      : `📊 No structural shift detected (${signals.length} partial signals)`,
  });
}

async function notifyTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch { /* non-critical */ }
}
