import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/morning-brief — unified pre-market intelligence report
// Combines: today's analysis, sector rotation, RS leaders, earnings, open positions, pending picks
const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = trySupabase();
  const today = new Date().toISOString().split("T")[0];
  const baseUrl = process.env.ZEABUR_URL || `http://localhost:${process.env.PORT || 3000}`;
  const secret = CRON_SECRET;

  // Gather data from internal endpoints (parallel where possible)
  const [analysisData, positionsData, pendingData] = await Promise.all([
    supabase?.from("analysis_results").select("symbol, scoring").eq("date", today).then(r => r.data) ?? [],
    supabase?.from("portfolio_positions").select("symbol, entry_price, shares, peak_price, stop_loss, entry_date").eq("status", "open").then(r => r.data) ?? [],
    supabase?.from("analysis_results").select("symbol, date, scoring, trade_plan").gte("date", new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0]).then(r => r.data) ?? [],
  ]);

  // Fetch vol regime + gaps (non-blocking)
  let volData: { regime?: string; vix?: number; vixChange?: string; sizeMultiplier?: number; signal?: string } = {};
  let gapsData: { gaps?: { symbol: string; gapPct: number }[] } = {};
  try {
    const [volRes, gapsRes] = await Promise.all([
      fetch(`${baseUrl}/api/cron/volatility-regime?secret=${secret}`).then(r => r.json()).catch(() => ({})),
      fetch(`${baseUrl}/api/cron/gap-scanner?secret=${secret}`).then(r => r.json()).catch(() => ({})),
    ]);
    volData = volRes;
    gapsData = gapsRes;
  } catch { /* non-critical */ }

  // Today's consensus picks
  const todayResults = (analysisData || []) as { symbol: string; scoring?: { consensus?: boolean; avgScore?: number; rsVsSpy?: number; conviction?: { convictionScore?: number; streak?: number } } }[];
  const consensus = todayResults.filter(r => r.scoring?.consensus);
  const topScorers = [...todayResults].sort((a, b) => (b.scoring?.avgScore || 0) - (a.scoring?.avgScore || 0)).slice(0, 5);

  // Open positions summary
  const positions = (positionsData || []) as { symbol: string; entry_price: number; shares: number; peak_price?: number; stop_loss?: number; entry_date?: string }[];

  // Pending picks (unacted consensus picks from past 7 days)
  const allConsensus = ((pendingData || []) as { symbol: string; date: string; scoring?: { consensus?: boolean } }[]).filter(r => r.scoring?.consensus);

  // Check decisions
  let decidedSet = new Set<string>();
  if (supabase && allConsensus.length > 0) {
    const { data: decisions } = await supabase.from("trade_decisions").select("symbol, date").gte("date", new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0]);
    decidedSet = new Set((decisions || []).map((d: { symbol: string; date: string }) => `${d.symbol}:${d.date}`));
  }
  const pending = allConsensus.filter(p => !decidedSet.has(`${p.symbol}:${p.date}`));

  // Build briefing text
  const brief = buildBriefing(today, consensus, topScorers, positions, pending, volData, gapsData);

  // Send via Telegram
  await notifyTelegram(brief);

  return NextResponse.json({ date: today, brief, consensus: consensus.length, positions: positions.length, pending: pending.length });
}

function buildBriefing(
  date: string,
  consensus: { symbol: string; scoring?: { avgScore?: number; rsVsSpy?: number; conviction?: { streak?: number } } }[],
  topScorers: { symbol: string; scoring?: { avgScore?: number; rsVsSpy?: number } }[],
  positions: { symbol: string; entry_price: number; shares: number; stop_loss?: number; entry_date?: string }[],
  pending: { symbol: string; date: string }[],
  volData: { regime?: string; vix?: number; vixChange?: string; sizeMultiplier?: number; signal?: string },
  gapsData: { gaps?: { symbol: string; gapPct: number }[] },
): string {
  const lines: string[] = [];
  lines.push(`☀️ <b>Morning Brief — ${date}</b>`);
  lines.push("═".repeat(28));

  // Vol regime + market context
  if (volData.regime) {
    const emoji = volData.regime === "LOW" ? "🟢" : volData.regime === "NORMAL" ? "🟡" : volData.regime === "HIGH" ? "🟠" : "🔴";
    lines.push(`\n${emoji} <b>Vol: ${volData.regime}</b> | VIX ${volData.vix} (${volData.vixChange}) | Size: ${volData.sizeMultiplier}x`);
  }

  // Pre-market gaps
  const gaps = gapsData.gaps || [];
  if (gaps.length > 0) {
    lines.push(`\n🔔 <b>Gaps:</b> ${gaps.slice(0, 5).map(g => `${g.symbol} ${g.gapPct > 0 ? "+" : ""}${g.gapPct}%`).join(", ")}`);
  }

  // Consensus picks
  if (consensus.length > 0) {
    lines.push(`\n🎯 <b>TODAY'S CONSENSUS:</b>`);
    for (const c of consensus) {
      const streak = c.scoring?.conviction?.streak ? ` 🔥${c.scoring.conviction.streak}d` : "";
      const rs = c.scoring?.rsVsSpy != null ? ` RS:${c.scoring.rsVsSpy > 0 ? "+" : ""}${c.scoring.rsVsSpy}%` : "";
      lines.push(`  🟢 ${c.symbol} — ${c.scoring?.avgScore?.toFixed(0)}/100${streak}${rs}`);
    }
  } else {
    lines.push(`\n⚪ No consensus picks today`);
  }

  // Top scorers
  lines.push(`\n📊 <b>Top 5 Scores:</b>`);
  for (const t of topScorers) {
    const rs = t.scoring?.rsVsSpy != null ? ` (RS:${t.scoring.rsVsSpy > 0 ? "+" : ""}${t.scoring.rsVsSpy}%)` : "";
    lines.push(`  ${t.symbol}: ${t.scoring?.avgScore?.toFixed(0) || "?"}${rs}`);
  }

  // Open positions with health flags
  if (positions.length > 0) {
    lines.push(`\n💼 <b>Positions (${positions.length}):</b>`);
    for (const p of positions) {
      const days = p.entry_date ? Math.floor((Date.now() - new Date(p.entry_date).getTime()) / 86400000) : 0;
      lines.push(`  ${p.symbol}: ${p.shares}sh @ $${p.entry_price.toFixed(2)} (${days}d)`);
    }
  }

  // Pending picks
  if (pending.length > 0) {
    lines.push(`\n⚡ <b>Pending (${pending.length}):</b> ${pending.map(p => `${p.symbol}`).join(", ")}`);
  }

  lines.push(`\n${"─".repeat(28)}`);
  lines.push(`📈 ${process.env.ZEABUR_URL || "/status"}`);

  return lines.join("\n");
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
