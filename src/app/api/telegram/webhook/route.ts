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
      await reply(chatId, `🤖 <b>Stock Dashboard Bot</b>\n\n/status — System health\n/score NVDA — Latest score\n/pending — Unacted picks\n/accept NVDA — Accept pick\n/reject NVDA — Reject pick\n/add NVDA — Add to watchlist\n/remove NVDA — Remove from watchlist\n/rs — RS leaders\n/shift — Structural shift\n/perf — Agent accuracy attribution\n/mtf [SYM] — Multi-timeframe trend\n/rebal — Rebalance suggestions\n/gaps — Pre-market gap scanner\n/vol — Volatility regime\n/health — Position risk check\n/corr — Correlation risks\n/run — Trigger scan\n/brief — Morning brief\n/help — This message`);
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

    case "/add": {
      if (!arg) { await reply(chatId, "Usage: /add NVDA"); break; }
      if (!supabase) { await reply(chatId, "⚠️ Supabase not configured"); break; }
      const sym = arg.includes(":") ? arg : `NASDAQ:${arg}`;
      const { error } = await supabase.from("watchlists").upsert({ symbol: sym, active: true }, { onConflict: "symbol" });
      await reply(chatId, error ? `❌ ${error.message}` : `✅ Added <b>${sym}</b> to watchlist`);
      break;
    }

    case "/watchlist":
    case "/wl": {
      if (!supabase) { await reply(chatId, "⚠️ Supabase not configured"); break; }
      const { data: wl } = await supabase.from("watchlists").select("symbol").eq("active", true);
      if (!wl || wl.length === 0) { await reply(chatId, "📋 Watchlist is empty"); break; }
      const syms = (wl as { symbol: string }[]).map(r => r.symbol.includes(":") ? r.symbol.split(":")[1] : r.symbol);
      await reply(chatId, `📋 <b>Watchlist (${syms.length})</b>\n\n${syms.join(", ")}`);
      break;
    }

    case "/remove": {
      if (!arg) { await reply(chatId, "Usage: /remove NVDA"); break; }
      if (!supabase) { await reply(chatId, "⚠️ Supabase not configured"); break; }
      const sym2 = arg.includes(":") ? arg : `NASDAQ:${arg}`;
      const { error } = await supabase.from("watchlists").update({ active: false }).eq("symbol", sym2);
      await reply(chatId, error ? `❌ ${error.message}` : `🗑️ Removed <b>${sym2}</b> from watchlist`);
      break;
    }

    case "/scan": {
      await reply(chatId, "🔍 Scanning universe for SNDK patterns...");
      try {
        const res = await fetch(`${baseUrl}/api/cron/sndk-scanner?secret=${CRON_SECRET}`);
        const data = await res.json();
        if (data.newCandidates?.length > 0) {
          await reply(chatId, `🆕 Found: ${data.newCandidates.join(", ")}\nAuto-added to watchlist.`);
        } else {
          await reply(chatId, `📊 Scanned ${data.scanned} stocks. ${data.signals} partial signals, no full match.`);
        }
      } catch { await reply(chatId, "❌ Scan failed"); }
      break;
    }

    case "/corr": {
      try {
        const res = await fetch(`${baseUrl}/api/cron/correlation?secret=${CRON_SECRET}`);
        const data = await res.json();
        const top = (data.highCorrelation || []).slice(0, 5).map((p: { a: string; b: string; correlation: number }) => `⚠️ ${p.a} ↔ ${p.b}: ${p.correlation.toFixed(2)}`);
        await reply(chatId, top.length > 0
          ? `📊 <b>Correlation Risks</b>\n\n${top.join("\n")}\n\n${data.warning}`
          : `✅ ${data.warning}`);
      } catch { await reply(chatId, "❌ Correlation check failed"); }
      break;
    }

    case "/perf": {
      try {
        const res = await fetch(`${baseUrl}/api/cron/performance-attribution?secret=${CRON_SECRET}`);
        const data = await res.json();
        if (!data.agentAttribution || data.agentAttribution.length === 0) {
          await reply(chatId, "📊 No closed trades for attribution yet");
          break;
        }
        const lines = data.agentAttribution.map((a: { agent: string; accuracy: number; callsMade: number; contribution: number }) =>
          `${a.accuracy >= 70 ? "🟢" : a.accuracy >= 50 ? "🟡" : "🔴"} ${a.agent}: ${a.accuracy}% acc (${a.callsMade} calls, ${a.contribution > 0 ? "+" : ""}${a.contribution}% P&L)`
        );
        await reply(chatId, `📊 <b>Agent Performance</b>\n\n${lines.join("\n")}\n\n🏆 Best: ${data.bestAgent}\n💀 Worst: ${data.worstAgent}`);
      } catch { await reply(chatId, "❌ Performance check failed"); }
      break;
    }

    case "/mtf": {
      const sym = arg || "";
      try {
        const url = sym ? `${baseUrl}/api/cron/multi-timeframe?secret=${CRON_SECRET}&symbol=${sym}` : `${baseUrl}/api/cron/multi-timeframe?secret=${CRON_SECRET}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!data.results || data.results.length === 0) { await reply(chatId, "❌ No MTF data"); break; }
        const lines = data.results.slice(0, 8).map((r: { symbol: string; daily: { trend: string }; weekly: { trend: string }; monthly: { trend: string }; alignment: string }) =>
          `${r.alignment.startsWith("🟢") ? "🟢" : r.alignment.startsWith("🔴") ? "🔴" : "⚠️"} ${r.symbol}: D=${r.daily.trend[0]} W=${r.weekly.trend[0]} M=${r.monthly.trend[0]}`
        );
        await reply(chatId, `📊 <b>Multi-Timeframe</b>\n\n${lines.join("\n")}\n\n${data.summary}`);
      } catch { await reply(chatId, "❌ MTF check failed"); }
      break;
    }

    case "/rebal": {
      try {
        const res = await fetch(`${baseUrl}/api/cron/smart-rebalance?secret=${CRON_SECRET}`);
        const data = await res.json();
        if (!data.suggestions || data.suggestions.length === 0) {
          await reply(chatId, data.message || "✅ No positions to rebalance");
          break;
        }
        const lines = data.suggestions.map((s: { symbol: string; action: string; currentWeight: number; reason: string }) =>
          `${s.action === "ADD" ? "🟢 ADD" : s.action === "TRIM" ? "🔴 TRIM" : "⚪ HOLD"} ${s.symbol} (${s.currentWeight}%)\n  ${s.reason}`
        );
        const extra = data.correlationWarnings?.length > 0 ? `\n\n${data.correlationWarnings[0]}` : "";
        await reply(chatId, `⚖️ <b>Rebalance</b>\n\n${lines.join("\n")}\n\n${data.summary}${extra}`);
      } catch { await reply(chatId, "❌ Rebalance check failed"); }
      break;
    }

    case "/gaps": {
      try {
        const res = await fetch(`${baseUrl}/api/cron/gap-scanner?secret=${CRON_SECRET}`);
        const data = await res.json();
        if (!data.gaps || data.gaps.length === 0) {
          await reply(chatId, `✅ No gaps >${data.threshold || 3}% on watchlist`);
          break;
        }
        const lines = data.gaps.map((g: { symbol: string; gapPct: number; current: number; isPreMarket: boolean }) =>
          `${g.gapPct > 0 ? "🟢" : "🔴"} ${g.symbol}: ${g.gapPct > 0 ? "+" : ""}${g.gapPct}% → $${g.current}${g.isPreMarket ? " (pre)" : ""}`
        );
        await reply(chatId, `📊 <b>Gap Scanner</b>\n\n${lines.join("\n")}`);
      } catch { await reply(chatId, "❌ Gap scan failed"); }
      break;
    }

    case "/vol": {
      try {
        const res = await fetch(`${baseUrl}/api/cron/volatility-regime?secret=${CRON_SECRET}`);
        const data = await res.json();
        const emoji = data.regime === "LOW" ? "🟢" : data.regime === "NORMAL" ? "🟡" : data.regime === "HIGH" ? "🟠" : "🔴";
        await reply(chatId, `${emoji} <b>Vol Regime: ${data.regime}</b>\n\nVIX: ${data.vix} (${data.vixChange})\nRealized: 5d=${data.realizedVol?.["5d"]}% 20d=${data.realizedVol?.["20d"]}%\nSize: ${data.sizeMultiplier}x\n\n${data.advice}\n${data.signal}`);
      } catch { await reply(chatId, "❌ Vol check failed"); }
      break;
    }

    case "/health": {
      try {
        const res = await fetch(`${baseUrl}/api/cron/position-health?secret=${CRON_SECRET}`);
        const data = await res.json();
        if (!data.health || data.health.length === 0) {
          await reply(chatId, data.message || "📋 No open positions");
          break;
        }
        const lines = data.health.map((h: { symbol: string; pnlPct: number; daysHeld: number; distToStop: number; flags: string[] }) =>
          `${h.flags.length > 0 ? "⚠️" : "✅"} ${h.symbol}: ${h.pnlPct > 0 ? "+" : ""}${h.pnlPct}% (${h.daysHeld}d, ${h.distToStop}% to stop)${h.flags.length > 0 ? "\n  " + h.flags.join(" ") : ""}`
        );
        await reply(chatId, `🏥 <b>Position Health</b>\n\nP&L: $${data.totalPnl}\n\n${lines.join("\n")}\n\n${data.summary}`);
      } catch { await reply(chatId, "❌ Health check failed"); }
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
    commands: ["/status", "/score <SYMBOL>", "/pending", "/rs", "/perf", "/mtf [SYM]", "/rebal", "/corr", "/run", "/brief", "/help"],
    setup: `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<URL>/api/telegram/webhook"`,
  });
}
