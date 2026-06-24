import { NextRequest, NextResponse } from "next/server";
import { getIndicatorSummary, calcRiskScore, type OHLCV } from "@/lib/indicators";
import { calcSupportResistance, calcTradePlan, type TradePlan } from "@/lib/levels";
import { runMultiAgentScoring, type AgentScore } from "@/lib/multi-agent-scoring";
import { scoreNewsSentiment } from "@/lib/news-sentiment";
import { computeConviction, type ConvictionResult } from "@/lib/conviction";
import { getSectorForStock } from "@/lib/sector-classification";
import { trySupabase } from "@/lib/supabase";
import { placeBracketOrder, calculatePositionSize } from "@/lib/ibkr-client";

// POST /api/cron/run-analysis
// Fetches price data, computes indicators + multi-agent scores, caches results.

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

async function fetchChart(yahooSymbol: string): Promise<OHLCV[]> {
  // Use yahoo-finance2 with proper ESM import
  const mod = await import("yahoo-finance2");
  const YahooFinance = mod.default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const period1 = new Date(Date.now() - 150 * 86400000).toISOString().split("T")[0];
  const result = await yf.chart(yahooSymbol, { period1, interval: "1d" });
  const quotes = result.quotes || [];
  return quotes
    .filter(q => q.open != null && q.high != null && q.low != null && q.close != null)
    .map(q => ({
      time: Math.floor(new Date(q.date).getTime() / 1000),
      open: q.open!,
      high: q.high!,
      low: q.low!,
      close: q.close!,
      volume: q.volume || 0,
    }));
}

async function notifyDiscord(results: { symbol: string; status: string; consensus?: boolean; avgScore?: number }[], date: string) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const consensusPicks = results.filter(r => r.consensus);
  const color = consensusPicks.length > 0 ? 0x00ff88 : 0x5865f2;

  const fields = results.map(r => ({
    name: r.symbol,
    value: `${r.status}${r.avgScore ? ` (${r.avgScore.toFixed(0)}/100)` : ""}`,
    inline: true,
  }));

  const embed = {
    title: `📊 每日分析完成 — ${date}`,
    color,
    description: consensusPicks.length > 0
      ? `🟢 **共識標的**: ${consensusPicks.map(r => r.symbol).join(", ")}`
      : "⚪ 今日無全員共識標的",
    fields,
    footer: { text: "Stock Dashboard Cron | 5-Agent Scoring" },
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch { /* non-critical */ }
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

// URGENT alert escalation: fires when consensus pick found
async function escalateAlert(picks: { symbol: string; avgScore?: number; scoring?: ReturnType<typeof runMultiAgentScoring>; tradePlan?: TradePlan | null }[]) {
  if (picks.length === 0) return;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  const symbols = picks.map(p => p.symbol).join(", ");
  const details = picks.map(p => {
    const agents = p.scoring?.agents.map(a => `${a.agent.split("(")[0]}=${a.score}`).join(", ") || "";
    return `🎯 <b>${p.symbol}</b> — avg ${p.avgScore?.toFixed(0)}/100\n   ${agents}`;
  }).join("\n");

  const urgentMsg = `🚨🚨🚨 <b>CONSENSUS PICK FOUND</b> 🚨🚨🚨\n\n${details}\n\n⚡ All 5 agents agree. Review immediately.\n📊 Dashboard: ${process.env.ZEABUR_URL || "check dashboard"}`;

  // Telegram: send with notification (no disable_notification)
  if (token && chatId) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: urgentMsg, parse_mode: "HTML" }),
      });
    } catch { /* non-critical */ }
  }

  // Discord: @everyone mention for urgency
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `@everyone 🚨 **CONSENSUS PICK: ${symbols}** — All 5 agents agree!`,
          embeds: [{
            title: "🚨 URGENT: Consensus Pick Found",
            color: 0xff0000,
            description: picks.map(p => `**${p.symbol}** — avg ${p.avgScore?.toFixed(0)}/100`).join("\n"),
            footer: { text: "Action required — review trade plan immediately" },
            timestamp: new Date().toISOString(),
          }],
        }),
      });
    } catch { /* non-critical */ }
  }

  // IBKR Auto-execution (Phase 3): place bracket orders for consensus picks
  if (process.env.IBKR_AUTO_EXECUTE === "true" && process.env.IBKR_ACCOUNT_ID) {
    for (const pick of picks) {
      if (!pick.tradePlan) continue;
      const { entry, stopLoss, target2 } = pick.tradePlan;
      const raw = pick.symbol.includes(":") ? pick.symbol.split(":")[1] : pick.symbol;
      const sizing = calculatePositionSize(entry, stopLoss);
      if (sizing.shares === 0) continue;

      try {
        const result = await placeBracketOrder({
          symbol: raw, entryPrice: entry, stopLossPrice: stopLoss,
          takeProfitPrice: target2, shares: sizing.shares,
        });
        // Notify about execution
        if (token && chatId) {
          const execMsg = `🤖 <b>AUTO-EXECUTE</b>: ${raw}\nShares: ${sizing.shares} @ $${entry.toFixed(2)}\nStop: $${stopLoss.toFixed(2)} | Target: $${target2.toFixed(2)}\nEntry: ${result.entry.status} | SL: ${result.stopLoss.status}`;
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: execMsg, parse_mode: "HTML" }),
          }).catch(() => {});
        }
      } catch { /* non-critical — don't break alert flow */ }
    }
  }
}

// Generate plaintext pre-market summary (for email/Telegram/clipboard)
function buildTextSummary(results: { symbol: string; status: string; consensus?: boolean; avgScore?: number; scoring?: ReturnType<typeof runMultiAgentScoring>; conviction?: ConvictionResult }[], date: string): string {
  const lines: string[] = [];
  const consensusPicks = results.filter(r => r.consensus);
  lines.push(`📊 Pre-Market Scan — ${date}`);
  lines.push(`${"─".repeat(36)}`);

  if (consensusPicks.length > 0) {
    lines.push(`🟢 共識標的: ${consensusPicks.map(r => r.symbol).join(", ")}`);
  } else {
    lines.push(`⚪ 今日無共識標的`);
  }
  lines.push("");

  for (const r of results) {
    if (!r.scoring) { lines.push(`${r.symbol}: ${r.status}`); continue; }
    const s = r.scoring;
    const bar = s.agents.map(a => `${a.agent.split("(")[1]?.replace(")", "") || a.agent}${a.score}`).join(" | ");
    const cvTag = r.conviction && r.conviction.streak >= 3 ? ` 🔥${r.conviction.streak}d` : "";
    lines.push(`${r.consensus ? "🟢" : "⚪"} ${r.symbol} — avg ${r.avgScore?.toFixed(0)}/100${cvTag}`);
    lines.push(`   ${bar}`);
    lines.push(`   ${s.recommendation}`);
  }

  lines.push(`${"─".repeat(36)}`);
  lines.push(`Scanned ${results.length} symbols | Consensus threshold: 65`);
  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  const supabase = trySupabase();

  // Fetch watchlist from Supabase, fallback to env var
  let watchlist: string[];
  if (supabase) {
    const { data: wlData } = await supabase.from("watchlists").select("symbol").eq("active", true);
    watchlist = wlData && wlData.length > 0 ? wlData.map(r => r.symbol) : [];
  } else {
    watchlist = [];
  }
  if (watchlist.length === 0) {
    watchlist = (process.env.WATCHLIST || "NASDAQ:TSLA,NASDAQ:NVDA,NASDAQ:AAPL,TWSE:2330,TWSE:2454").split(",");
  }

  const today = new Date().toISOString().split("T")[0];
  const results: { symbol: string; status: string; consensus?: boolean; avgScore?: number; scoring?: ReturnType<typeof runMultiAgentScoring>; tradePlan?: TradePlan | null; conviction?: ConvictionResult }[] = [];

  for (const symbol of watchlist) {
    try {
      const raw = symbol.includes(":") ? symbol.split(":")[1] : symbol;
      const yahooSymbol = symbol.startsWith("TWSE:") ? `${raw}.TW` : raw;

      const periods = await fetchChart(yahooSymbol);
      if (periods.length < 20) { results.push({ symbol, status: "跳過：資料不足" }); continue; }

      const indicators = getIndicatorSummary(periods);
      const riskScore = calcRiskScore(periods);
      const levels = calcSupportResistance(periods);
      const tradePlan = calcTradePlan(periods, levels);

      // Fetch real news sentiment (optional — skipped if no FINNHUB_API_KEY)
      let newsAgent: AgentScore | undefined;
      try {
        const ns = await scoreNewsSentiment(symbol);
        if (ns.newsCount > 0) {
          newsAgent = { agent: "News(新聞)", score: ns.score, signal: ns.signal, reasoning: ns.reasoning };
        }
      } catch { /* non-critical */ }

      const scoring = runMultiAgentScoring(symbol, periods, newsAgent);

      // Conviction overlay: tracks score trend over recent days
      const conviction = await computeConviction(symbol, scoring.avgScore, scoring.consensus);
      const sectorCtx = getSectorForStock(symbol);

      const last = periods[periods.length - 1];
      const analysis = buildAnalysis(symbol, last, indicators, riskScore, levels, tradePlan, scoring);

      // Write to Supabase if available and not dry-run
      if (supabase && !dryRun) {
        await supabase.from("analysis_results").upsert({
          symbol, date: today, analysis,
          scoring: { consensus: scoring.consensus, avgScore: scoring.avgScore, agents: scoring.agents, recommendation: scoring.recommendation, conviction, sector: sectorCtx },
          indicators, trade_plan: tradePlan, ts: Date.now(),
        }, { onConflict: "symbol,date" });
      }

      results.push({
        symbol, status: scoring.consensus ? "🟢 共識通過" : "⚪ 完成",
        consensus: scoring.consensus, avgScore: scoring.avgScore, scoring, tradePlan,
        conviction,
      });
    } catch (e) {
      results.push({ symbol, status: `❌ ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  // Write run summary + notify (skip in dry-run)
  if (supabase && !dryRun) {
    await supabase.from("analysis_runs").upsert({ date: today, ts: Date.now(), results: results.map(({ scoring: _s, ...r }) => r) }, { onConflict: "date" });
  }
  if (!dryRun) await notifyDiscord(results, today);

  const textSummary = buildTextSummary(results, today);
  if (!dryRun) await notifyTelegram(textSummary);

  // URGENT escalation for consensus picks
  const consensusPicks = results.filter(r => r.consensus);
  if (!dryRun && consensusPicks.length > 0) await escalateAlert(consensusPicks);

  return NextResponse.json({ date: today, dryRun, supabaseConnected: !!supabase, results: results.map(({ scoring: _s, ...r }) => r), textSummary });
}

function buildAnalysis(
  symbol: string, last: OHLCV, indicators: ReturnType<typeof getIndicatorSummary>,
  riskScore: number, levels: ReturnType<typeof calcSupportResistance>,
  tradePlan: ReturnType<typeof calcTradePlan>, scoring: ReturnType<typeof runMultiAgentScoring>
): string {
  const supports = levels.filter(l => l.type === "support").slice(0, 3);
  const resistances = levels.filter(l => l.type === "resistance").slice(0, 3);
  const macdStatus = indicators.macd.dif > indicators.macd.dea ? "多頭" : "空頭";
  const rsiStatus = indicators.rsi.value > 70 ? "超買" : indicators.rsi.value < 30 ? "超賣" : "中性";

  return `## ${symbol} — ${scoring.recommendation}

### 多重代理人評分 (共識: ${scoring.consensus ? "✅" : "❌"}, 均分: ${scoring.avgScore.toFixed(0)}/100)
${scoring.agents.map(a => `| ${a.agent} | ${a.score}/100 ${a.signal} | ${a.reasoning} |`).join("\n")}

### 技術面
- 收盤價：${last.close.toFixed(2)}
- MACD：DIF=${indicators.macd.dif.toFixed(2)} DEA=${indicators.macd.dea.toFixed(2)} ${macdStatus}
- RSI(14)：${indicators.rsi.value.toFixed(1)} ${rsiStatus}
- KDJ：K=${indicators.kdj.k.toFixed(1)} D=${indicators.kdj.d.toFixed(1)} J=${indicators.kdj.j.toFixed(1)}
- 均線：${indicators.ma.status}

### 關鍵價位
支撐：${supports.map(l => l.price.toFixed(2)).join(" / ") || "N/A"}
壓力：${resistances.map(l => l.price.toFixed(2)).join(" / ") || "N/A"}

### 交易計劃
${tradePlan ? `進場=${tradePlan.entry.toFixed(2)} 停損=${tradePlan.stopLoss.toFixed(2)} T1=${tradePlan.target1.toFixed(2)} T2=${tradePlan.target2.toFixed(2)} R:R=1:${tradePlan.riskReward.toFixed(1)}` : "無"}

### 風險 ${riskScore}/10 ${riskScore >= 7 ? "🔴" : riskScore >= 4 ? "🟡" : "🟢"}`;
}
