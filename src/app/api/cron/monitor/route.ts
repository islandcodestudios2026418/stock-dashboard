import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";
import { placeOrder } from "@/lib/ibkr-client";

// GET /api/cron/monitor — checks open positions against trailing stop rules
// Called by cron every 5 min during market hours, or manually.
// Rules: 40% absolute stop, 25% trailing stop (if gain > 10% from entry)

const CRON_SECRET = process.env.CRON_SECRET || "";
const ABS_STOP_PCT = 0.40;
const TRAIL_STOP_PCT = 0.25;
const TRAIL_ACTIVATE_PCT = 0.10;

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

interface Position {
  id: string;
  symbol: string;
  entry_price: number;
  shares: number;
  peak_price?: number;
  status: string;
}

async function fetchCurrentPrice(symbol: string): Promise<number> {
  const mod = await import("yahoo-finance2");
  const YahooFinance = mod.default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const quote = await yf.quote(symbol);
  return quote.regularMarketPrice || 0;
}

async function notifyExit(symbol: string, reason: string, entryPrice: number, exitPrice: number, pnlPct: number) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const emoji = pnlPct >= 0 ? "🟢" : "🔴";
  const msg = `${emoji} <b>POSITION EXIT</b>: ${symbol}\nReason: ${reason}\nEntry: $${entryPrice.toFixed(2)} → Exit: $${exitPrice.toFixed(2)}\nP&L: ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%`;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "HTML" }),
    });
  } catch { /* non-critical */ }
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  // Fetch open positions from portfolio_positions table
  const { data: positions } = await supabase
    .from("portfolio_positions")
    .select("*")
    .eq("status", "open");

  if (!positions || positions.length === 0) {
    return NextResponse.json({ message: "No open positions", exits: [] });
  }

  const exits: { symbol: string; reason: string; exitPrice: number; pnlPct: number }[] = [];

  for (const pos of positions as Position[]) {
    try {
      const currentPrice = await fetchCurrentPrice(pos.symbol);
      if (!currentPrice) continue;

      const entryPrice = pos.entry_price;
      const gainPct = (currentPrice - entryPrice) / entryPrice;
      const peakPrice = Math.max(pos.peak_price || entryPrice, currentPrice);

      // Update peak price in DB
      if (currentPrice > (pos.peak_price || 0)) {
        await supabase.from("portfolio_positions").update({ peak_price: currentPrice }).eq("id", pos.id);
      }

      let shouldExit = false;
      let reason = "";

      // Rule 1: 40% absolute stop
      if (gainPct <= -ABS_STOP_PCT) {
        shouldExit = true;
        reason = `Absolute stop (-${(ABS_STOP_PCT * 100).toFixed(0)}%)`;
      }

      // Rule 2: 25% trailing stop (activates after 10% gain)
      if (!shouldExit && (peakPrice - entryPrice) / entryPrice >= TRAIL_ACTIVATE_PCT) {
        const dropFromPeak = (peakPrice - currentPrice) / peakPrice;
        if (dropFromPeak >= TRAIL_STOP_PCT) {
          shouldExit = true;
          reason = `Trailing stop (-${(TRAIL_STOP_PCT * 100).toFixed(0)}% from peak $${peakPrice.toFixed(2)})`;
        }
      }

      if (shouldExit) {
        const pnlPct = gainPct * 100;

        // Place sell order via IBKR (if enabled)
        if (process.env.IBKR_AUTO_EXECUTE === "true" && process.env.IBKR_ACCOUNT_ID) {
          try {
            await placeOrder({
              symbol: pos.symbol, side: "SELL", quantity: pos.shares,
              orderType: "MKT", tif: "DAY",
            });
          } catch { /* log but don't break */ }
        }

        // Mark position as stopped in DB
        await supabase.from("portfolio_positions").update({
          status: "stopped", exit_price: currentPrice, closed_at: new Date().toISOString(),
        }).eq("id", pos.id);

        await notifyExit(pos.symbol, reason, entryPrice, currentPrice, pnlPct);
        exits.push({ symbol: pos.symbol, reason, exitPrice: currentPrice, pnlPct });
      }
    } catch { /* skip this position */ }
  }

  return NextResponse.json({ checked: positions.length, exits });
}
