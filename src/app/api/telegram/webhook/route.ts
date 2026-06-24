import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// POST /api/telegram/webhook — receives Telegram Bot updates, parses commands, replies inline
// Commands: /status, /score <SYMBOL>, /run, /pending, /rs, /help
// Setup: set webhook via Telegram API:
//   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<URL>/api/telegram/webhook"

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
    from?: { id: number; first_name: string };
  };
}

async function reply(chatId: number, text: string) {
  if (!TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

async function handleCommand(chatId: number, text: string) {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase().replace("@", "").split("@")[0]; // handle @botname suffix
  const arg = parts[1]?.toUpperCase();

  const supabase = trySupabase();
  const baseUrl = process.env.ZEABUR_URL || "http://localhost:3000";

  switch (cmd) {
    case "/help":
    case "/start":
      await reply(chatId, `🤖 <b>Stock Dashboard Bot</b>\n\n/status — System health\n/score NVDA — Latest score for symbol\n/pending — Unacted consensus picks\n/accept NVDA [reason] — Accept a pick\n/reject NVDA [reason] — Reject a pick\n/rs — Relative strength leaders\n/shift — Structural shift detector\n/run — Trigger manual analysis\n/brief — Morning briefing\n/help — This message`);
      break;

    case "/status": {
      if (!supabase) { await reply(chatId, "⚠️ Supabase not configured"); break; }
      const { data: lastRun } = await supabase.from("analysis_runs").select("date, ts").order("ts", { ascending: false }).limit(1).single();
      const { count: openPos } = await supabase.from("portfolio_positions").select("*", { count: "exact", head: true }).eq("status", "open");
      const { count: wlSize } = await supabase.from("watchlists").select("*", { count: "exact", head: true }).eq("active", true);
      const hoursAgo = lastRun?.ts ? Math.round((Date.now() - lastRun.ts) / 3600000) : null;
      const health = hoursAgo !== null && hoursAgo < 24 ? "🟢" : "🟡";
      await reply(chatId, `${health} <b>System Status</b>\n\nLast run: ${lastRun?.date || "never"} (${hoursAgo}h ago)\nOpen positions: ${openPos || 0}\nWatchlist: ${wlSize || 0} symbols`);
      break;
    }

    case "/score": {
      if (!arg) { await reply(chatId, "Usage: /score NVDA"); break; }
      if (!supabase) { await reply(chatId, "⚠️ Supabase not configured"); break; }
      const { data } = await supabase.from("analysis_results").select("date, scoring").eq("symbol", arg).order("date", { ascending: false }).limit(1).single();
      if (!data) {
        // Try with exchange prefix
        const { data: d2 } = await supabase.from("analysis_results").select("date, scoring").like("symbol", `%${arg}%`).order("date", { ascending: false }).limit(1).single();
        if (!d2) { await reply(chatId, `❓ No data for ${arg}`); break; }
        const s = d2.scoring as { avgScore?: number; consensus?: boolean; agents?: { agent: string; score: number }[]; rsVsSpy?: number };
        const agents = s.agents?.map(a => `${a.agent.split("(")[1]?.replace(")", "") || a.agent}${a.score}`).join(" | ") || "";
        await reply(chatId, `📊 <b>${arg}</b> (${d2.date})\nScore: ${s.avgScore?.toFixed(0)}/100 ${s.consensus ? "🟢" : "⚪"}\n${agents}${s.rsVsSpy != null ? `\nRS vs SPY: ${s.rsVsSpy > 0 ? "+" : ""}${s.rsVsSpy}%` : ""}`);
        break;
      }
      const s = data.scoring as { avgScore?: number; consensus?: boolean; agents?: { agent: string; score: number }[]; rsVsSpy?: number };
      const agents = s.agents?.map(a => `${a.agent.split("(")[1]?.replace(")", "") || a.agent}${a.score}`).join(" | ") || "";
      await reply(chatId, `📊 <b>${arg}</b> (${data.date})\nScore: ${s.avgScore?.toFixed(0)}/100 ${s.consensus ? "🟢" : "⚪"}\n${agents}${s.rsVsSpy != null ? `\nRS vs SPY: ${s.rsVsSpy > 0 ? "+" : ""}${s.rsVsSpy}%` : ""}`);
      break;
    }

    case "/pending": {
      if (!supabase) { await reply(chatId, "⚠️ Supabase not configured"); break; }
      const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
      const { data: results } = await supabase.from("analysis_results").select("symbol, date, scoring").gte("date", cutoff);
      const consensus = (results || []).filter((r: { scoring?: { consensus?: boolean } }) => r.scoring?.consensus);
      const { data: decisions } = await supabase.from("trade_decisions").select("symbol, date").gte("date", cutoff);
      const decidedSet = new Set((decisions || []).map((d: { symbol: string; date: string }) => `${d.symbol}:${d.date}`));
      const pending = consensus.filter((p: { symbol: string; date: string }) => !decidedSet.has(`${p.symbol}:${p.date}`));
      if (pending.length === 0) { await reply(chatId, "✅ No pending picks — all acted on"); break; }
      const lines = pending.map((p: { symbol: string; date: string; scoring?: { avgScore?: number } }) => `⚡ ${p.symbol} (${p.date}) — ${(p.scoring as { avgScore?: number })?.avgScore?.toFixed(0) || "?"}/100`);
      await reply(chatId, `⚡ <b>Pending Picks (${pending.length})</b>\n\n${lines.join("\n")}`);
      break;
    }

    case "/rs": {
      try {
        const res = await fetch(`${baseUrl}/api/cron/relative-strength?secret=${CRON_SECRET}`);
        const data = await res.json();
        const top5 = (data.rankings || []).slice(0, 5).map((r: { symbol: string; rsRating: number; relStrength: number }, i: number) => `${i + 1}. ${r.symbol} RS:${r.rsRating} (${r.relStrength > 0 ? "+" : ""}${r.relStrength}%)`);
        await reply(chatId, `💪 <b>RS Leaders vs SPY</b>\n\n${top5.join("\n")}`);
      } catch { await reply(chatId, "❌ Failed to fetch RS data"); }
      break;
    }

    case "/run": {
      await reply(chatId, "⏳ Triggering analysis...");
      try {
        const res = await fetch(`${baseUrl}/api/cron/trigger?secret=${CRON_SECRET}`);
        const data = await res.json();
        await reply(chatId, `✅ Analysis complete. ${(data.results || []).length} symbols scanned.`);
      } catch { await reply(chatId, "❌ Trigger failed"); }
      break;
    }

    case "/brief": {
      try {
        await fetch(`${baseUrl}/api/cron/morning-brief?secret=${CRON_SECRET}`);
        // The brief endpoint itself sends the Telegram message
      } catch { await reply(chatId, "❌ Brief failed"); }
      break;
    }

    case "/shift": {
      try {
        const res = await fetch(`${baseUrl}/api/cron/structural-shift?secret=${CRON_SECRET}`);
        const data = await res.json();
        if (data.signals?.length > 0) {
          const top = data.signals.slice(0, 5).map((s: { symbol: string; shiftScore: number; reasoning: string }) => `${s.shiftScore >= 70 ? "🔥" : "📊"} ${s.symbol}: ${s.shiftScore}/100\n  ${s.reasoning}`);
          await reply(chatId, `🏭 <b>Structural Shift Scan</b>\n\n${top.join("\n\n")}`);
        } else {
          await reply(chatId, "📊 No structural shift signals detected");
        }
      } catch { await reply(chatId, "❌ Shift scan failed"); }
      break;
    }

    case "/accept": {
      if (!arg) { await reply(chatId, "Usage: /accept NVDA [reason]"); break; }
      if (!supabase) { await reply(chatId, "⚠️ Supabase not configured"); break; }
      const reason = parts.slice(2).join(" ") || "Accepted via Telegram";
      const { error } = await supabase.from("trade_decisions").insert({
        symbol: arg, decision: "accepted", reason, date: new Date().toISOString().split("T")[0],
      });
      await reply(chatId, error ? `❌ ${error.message}` : `✅ <b>${arg}</b> accepted: ${reason}`);
      break;
    }

    case "/reject": {
      if (!arg) { await reply(chatId, "Usage: /reject NVDA [reason]"); break; }
      if (!supabase) { await reply(chatId, "⚠️ Supabase not configured"); break; }
      const reason = parts.slice(2).join(" ") || "Rejected via Telegram";
      const { error } = await supabase.from("trade_decisions").insert({
        symbol: arg, decision: "rejected", reason, date: new Date().toISOString().split("T")[0],
      });
      await reply(chatId, error ? `❌ ${error.message}` : `🚫 <b>${arg}</b> rejected: ${reason}`);
      break;
    }

    default:
      if (text.startsWith("/")) {
        await reply(chatId, `❓ Unknown command. Try /help`);
      }
  }
}

export async function POST(req: NextRequest) {
  const update: TelegramUpdate = await req.json();

  // Only respond to messages from authorized chat
  const chatId = update.message?.chat?.id;
  const text = update.message?.text;
  if (!chatId || !text) return NextResponse.json({ ok: true });

  // Security: only respond to configured chat ID (if set)
  if (TELEGRAM_CHAT_ID && String(chatId) !== TELEGRAM_CHAT_ID) {
    return NextResponse.json({ ok: true }); // silently ignore unauthorized chats
  }

  await handleCommand(chatId, text);
  return NextResponse.json({ ok: true });
}

// GET: health check / webhook info
export async function GET() {
  return NextResponse.json({
    webhook: "active",
    commands: ["/status", "/score <SYMBOL>", "/pending", "/rs", "/run", "/brief", "/help"],
    setup: `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<URL>/api/telegram/webhook"`,
  });
}
