import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/watchlist-rotation — removes stale symbols, grades watchlist health
// Stale = avg score < 40 for 4+ weeks (28 days). Auto-deactivates them.
const CRON_SECRET = process.env.CRON_SECRET || "";
const STALE_DAYS = 28;
const STALE_THRESHOLD = 40;

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const cutoff = new Date(Date.now() - STALE_DAYS * 86400000).toISOString().split("T")[0];

  // Get active watchlist
  const { data: watchlist } = await supabase.from("watchlists").select("symbol").eq("active", true);
  if (!watchlist || watchlist.length === 0) {
    return NextResponse.json({ message: "Empty watchlist", removed: [], kept: [] });
  }

  // Get analysis scores for past STALE_DAYS
  const { data: results } = await supabase
    .from("analysis_results")
    .select("symbol, scoring")
    .gte("date", cutoff);

  // Compute per-symbol avg score
  const scoreMap: Record<string, number[]> = {};
  for (const r of results || []) {
    const s = r as { symbol: string; scoring?: { avgScore?: number } };
    if (s.scoring?.avgScore != null) {
      (scoreMap[s.symbol] ||= []).push(s.scoring.avgScore);
    }
  }

  const removed: { symbol: string; avgScore: number; scans: number }[] = [];
  const kept: { symbol: string; avgScore: number; grade: string }[] = [];

  for (const { symbol } of watchlist) {
    const scores = scoreMap[symbol] || [];
    const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    // Stale: avg < threshold AND has been scanned at least 5 times (enough data)
    if (avg < STALE_THRESHOLD && scores.length >= 5) {
      if (!dryRun) {
        await supabase.from("watchlists").update({ active: false }).eq("symbol", symbol);
      }
      removed.push({ symbol, avgScore: Math.round(avg), scans: scores.length });
    } else {
      const grade = avg >= 65 ? "A" : avg >= 50 ? "B" : avg >= 40 ? "C" : scores.length < 5 ? "NEW" : "D";
      kept.push({ symbol, avgScore: Math.round(avg), grade });
    }
  }

  // Notify if symbols were removed
  if (removed.length > 0 && !dryRun) {
    const msg = `🔄 <b>Watchlist Rotation</b>\n\n❌ Removed (avg &lt; ${STALE_THRESHOLD} over ${STALE_DAYS}d):\n${removed.map(r => `  ${r.symbol} — ${r.avgScore}/100 (${r.scans} scans)`).join("\n")}\n\n✅ Kept: ${kept.length} symbols`;
    await notifyTelegram(msg);
  }

  return NextResponse.json({ dryRun, removed, kept, summary: { total: watchlist.length, removed: removed.length, kept: kept.length } });
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
