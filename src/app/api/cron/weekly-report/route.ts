import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/weekly-report — aggregates past week's analysis + P&L, sends Telegram/Discord
const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

interface WeeklyStats {
  period: string;
  scans: number;
  consensusPicks: { symbol: string; date: string; avgScore: number }[];
  topScorers: { symbol: string; avgScore: number }[];
  portfolioStats: { trades: number; wins: number; winRate: number; totalPnl: number; bestTrade: string; worstTrade: string };
  watchlistHealth: { total: number; avgScore: number; stale: string[] };
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = trySupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const startDate = weekAgo.toISOString().split("T")[0];
  const endDate = now.toISOString().split("T")[0];

  // Fetch week's analysis results
  const { data: results } = await supabase
    .from("analysis_results")
    .select("symbol, date, scoring")
    .gte("date", startDate)
    .lte("date", endDate);

  // Fetch week's portfolio activity
  const { data: closedPositions } = await supabase
    .from("portfolio_positions")
    .select("*")
    .gte("closed_at", weekAgo.toISOString())
    .in("status", ["closed", "stopped"]);

  // Fetch analysis runs count
  const { data: runs } = await supabase
    .from("analysis_runs")
    .select("date")
    .gte("date", startDate);

  // Compute stats
  const consensusPicks = (results || [])
    .filter((r: { scoring?: { consensus?: boolean; avgScore?: number } }) => r.scoring?.consensus)
    .map((r: { symbol: string; date: string; scoring: { avgScore: number } }) => ({ symbol: r.symbol, date: r.date, avgScore: r.scoring.avgScore }));

  // Top scorers (avg score per symbol this week)
  const scoreMap: Record<string, number[]> = {};
  for (const r of results || []) {
    const s = (r as { symbol: string; scoring?: { avgScore?: number } });
    if (s.scoring?.avgScore) {
      (scoreMap[s.symbol] ||= []).push(s.scoring.avgScore);
    }
  }
  const topScorers = Object.entries(scoreMap)
    .map(([symbol, scores]) => ({ symbol, avgScore: scores.reduce((a, b) => a + b, 0) / scores.length }))
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 5);

  // Stale symbols (avg < 40 this week)
  const stale = Object.entries(scoreMap)
    .filter(([, scores]) => scores.reduce((a, b) => a + b, 0) / scores.length < 40)
    .map(([s]) => s);

  // Portfolio stats
  const closed = closedPositions || [];
  const wins = closed.filter((p: { entry_price: number; exit_price?: number }) => (p.exit_price || 0) > p.entry_price);
  const pnls = closed.map((p: { entry_price: number; exit_price?: number; shares: number }) => ((p.exit_price || p.entry_price) - p.entry_price) * p.shares);
  const totalPnl = pnls.reduce((a: number, b: number) => a + b, 0);
  const pnlPcts = closed.map((p: { entry_price: number; exit_price?: number }) => ((p.exit_price || p.entry_price) - p.entry_price) / p.entry_price * 100);
  const bestIdx = pnlPcts.indexOf(Math.max(...pnlPcts, -Infinity));
  const worstIdx = pnlPcts.indexOf(Math.min(...pnlPcts, Infinity));

  const stats: WeeklyStats = {
    period: `${startDate} → ${endDate}`,
    scans: runs?.length || 0,
    consensusPicks,
    topScorers,
    portfolioStats: {
      trades: closed.length,
      wins: wins.length,
      winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
      totalPnl,
      bestTrade: bestIdx >= 0 ? `${closed[bestIdx].symbol} +${pnlPcts[bestIdx].toFixed(1)}%` : "N/A",
      worstTrade: worstIdx >= 0 ? `${closed[worstIdx].symbol} ${pnlPcts[worstIdx].toFixed(1)}%` : "N/A",
    },
    watchlistHealth: {
      total: Object.keys(scoreMap).length,
      avgScore: topScorers.length > 0 ? topScorers.reduce((a, b) => a + b.avgScore, 0) / topScorers.length : 0,
      stale,
    },
  };

  // Build report text
  const report = formatReport(stats);

  // Send notifications
  await notifyTelegram(report);
  await notifyDiscord(stats);

  return NextResponse.json({ stats, report });
}

function formatReport(s: WeeklyStats): string {
  const lines = [
    `📈 <b>週報</b> ${s.period}`,
    `${"─".repeat(30)}`,
    `📊 掃描次數: ${s.scans}`,
    `🎯 共識標的: ${s.consensusPicks.length > 0 ? s.consensusPicks.map(p => `${p.symbol}(${p.date})`).join(", ") : "無"}`,
    "",
    `🏆 本週最高分:`,
    ...s.topScorers.map((t, i) => `  ${i + 1}. ${t.symbol} — ${t.avgScore.toFixed(0)}/100`),
    "",
    `💰 投資組合:`,
    `  交易: ${s.portfolioStats.trades} | 勝率: ${s.portfolioStats.winRate.toFixed(0)}%`,
    `  總損益: $${s.portfolioStats.totalPnl.toFixed(0)}`,
    `  最佳: ${s.portfolioStats.bestTrade}`,
    `  最差: ${s.portfolioStats.worstTrade}`,
    "",
    `🩺 監控清單健康:`,
    `  追蹤: ${s.watchlistHealth.total} | 均分: ${s.watchlistHealth.avgScore.toFixed(0)}`,
    `  ${s.watchlistHealth.stale.length > 0 ? `⚠️ 低分: ${s.watchlistHealth.stale.join(", ")}` : "✅ 全數正常"}`,
  ];
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

async function notifyDiscord(stats: WeeklyStats) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: `📈 週報 ${stats.period}`,
          color: stats.consensusPicks.length > 0 ? 0x00ff88 : 0x5865f2,
          fields: [
            { name: "掃描", value: `${stats.scans} 次`, inline: true },
            { name: "共識標的", value: `${stats.consensusPicks.length}`, inline: true },
            { name: "勝率", value: `${stats.portfolioStats.winRate.toFixed(0)}%`, inline: true },
            { name: "總損益", value: `$${stats.portfolioStats.totalPnl.toFixed(0)}`, inline: true },
            { name: "最高分", value: stats.topScorers.slice(0, 3).map(t => `${t.symbol} ${t.avgScore.toFixed(0)}`).join("\n") || "N/A", inline: false },
          ],
          timestamp: new Date().toISOString(),
        }],
      }),
    });
  } catch { /* non-critical */ }
}
