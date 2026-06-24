import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/sndk-scanner — scans broader universe for SNDK-pattern candidates
// Looks for: stocks breaking out of 6+ month bases with volume surge
// These get auto-added to watchlist for daily scoring

const CRON_SECRET = process.env.CRON_SECRET || "";

// Universe: top US tech/growth stocks that could have SNDK-like structural shifts
const SCAN_UNIVERSE = [
  // Semis (SNDK's sector)
  "MU", "MRVL", "ON", "LRCX", "KLAC", "AMAT", "ASML", "TXN",
  // AI/cloud
  "PLTR", "SNOW", "CRWD", "NET", "DDOG", "ZS", "PANW",
  // Growth tech
  "SHOP", "SQ", "COIN", "HOOD", "RBLX", "U",
  // Energy transition
  "FSLR", "SEDG", "RUN", "PLUG",
  // Biotech catalysts
  "MRNA", "REGN", "VRTX",
  // Industrials/reshoring
  "URI", "PWR", "EME",
];

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

interface ScanResult {
  symbol: string;
  baseBreakout: boolean;
  volumeSurge: boolean;
  return60d: number;
  addedToWatchlist: boolean;
}

async function analyzeSymbol(symbol: string): Promise<ScanResult | null> {
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const period1 = new Date(Date.now() - 150 * 86400000).toISOString().split("T")[0];
    const result = await yf.chart(symbol, { period1, interval: "1d" });
    const quotes = (result.quotes || []).filter(q => q.close != null && q.volume != null);
    if (quotes.length < 60) return null;

    const closes = quotes.map(q => q.close!);
    const volumes = quotes.map(q => q.volume || 0);
    const highs = quotes.map(q => q.high || q.close!);
    const current = closes[closes.length - 1];

    // 60d return
    const c60 = closes[Math.max(0, closes.length - 61)];
    const return60d = ((current - c60) / c60) * 100;

    // Base breakout: price above 120-day high range
    const longTermHigh = Math.max(...highs.slice(0, -5));
    const baseBreakout = current > longTermHigh * 1.03; // 3% above prior high

    // Volume surge: recent 5d volume > 2x 60d average
    const recent5Vol = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const avg60Vol = volumes.slice(-60).reduce((a, b) => a + b, 0) / Math.min(60, volumes.length);
    const volumeSurge = recent5Vol > avg60Vol * 1.8;

    return { symbol, baseBreakout, volumeSurge, return60d: Math.round(return60d * 100) / 100, addedToWatchlist: false };
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = trySupabase();

  // Get current watchlist to skip already-tracked symbols
  let currentWatchlist = new Set<string>();
  if (supabase) {
    const { data } = await supabase.from("watchlists").select("symbol").eq("active", true);
    currentWatchlist = new Set((data || []).map((r: { symbol: string }) => {
      const s = r.symbol;
      return s.includes(":") ? s.split(":")[1] : s;
    }));
  }

  // Filter universe to only scan symbols not already in watchlist
  const toScan = SCAN_UNIVERSE.filter(s => !currentWatchlist.has(s));

  const results: ScanResult[] = [];
  const candidates: string[] = [];

  for (const symbol of toScan) {
    const result = await analyzeSymbol(symbol);
    if (!result) continue;

    // SNDK pattern: base breakout + volume surge OR very strong return
    if (result.baseBreakout && result.volumeSurge) {
      candidates.push(symbol);
      result.addedToWatchlist = true;

      // Auto-add to watchlist
      if (supabase) {
        await supabase.from("watchlists").upsert({ symbol: `NASDAQ:${symbol}`, active: true }, { onConflict: "symbol" });
      }
    }

    if (result.baseBreakout || result.volumeSurge || result.return60d > 20) {
      results.push(result);
    }
  }

  // Sort by return
  results.sort((a, b) => b.return60d - a.return60d);

  // Notify if new candidates found
  if (candidates.length > 0) {
    const msg = `🔍 <b>SNDK Scanner: New Candidates</b>\n\n${candidates.map(s => `🆕 ${s} — base breakout + volume surge`).join("\n")}\n\n→ Auto-added to watchlist for daily scoring`;
    await notifyTelegram(msg);
  }

  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    scanned: toScan.length,
    signals: results.length,
    newCandidates: candidates,
    results: results.slice(0, 15),
    summary: candidates.length > 0
      ? `🔍 Found ${candidates.length} SNDK-pattern candidates: ${candidates.join(", ")}`
      : `📊 Scanned ${toScan.length} stocks, ${results.length} partial signals, no full pattern match`,
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
