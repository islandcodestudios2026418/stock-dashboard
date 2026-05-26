#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Re-use our analysis engine
import { OHLCV, getIndicatorSummary, calcRiskScore } from "../lib/indicators";
import { calcSupportResistance, calcTradePlan } from "../lib/levels";

const server = new McpServer({ name: "stock-analysis", version: "1.0.0" });

// --- Helper: fetch stock data from TradingView ---
async function fetchStock(symbol: string, timeframe = "1D", range = 300): Promise<{ symbol: string; name: string; periods: OHLCV[] }> {
  const TradingView = await import("@mathieuc/tradingview");
  const client = new TradingView.Client({
    token: process.env.TRADINGVIEW_SESSION || "",
    signature: process.env.TRADINGVIEW_SIGNATURE || "",
  });
  const chart = new client.Session.Chart();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { client.end(); reject(new Error("timeout")); }, 15000);
    chart.setMarket(symbol, { timeframe, range });
    chart.onUpdate(() => {
      clearTimeout(timeout);
      const periods = chart.periods;
      const info = chart.infos;
      client.end();
      resolve({
        symbol: info?.full_name || symbol,
        name: info?.short_description || info?.description || symbol,
        periods: (periods as unknown as Array<Record<string, number>>)
          .filter(p => p.time && p.open != null && p.close != null)
          .map(p => ({ time: +p.time, open: +p.open || 0, high: +(p.max || p.high) || 0, low: +(p.min || p.low) || 0, close: +p.close || 0, volume: +p.volume || 0 }))
          .filter(p => p.high > 0 && p.low > 0)
          .sort((a, b) => a.time - b.time),
      });
    });
    chart.onError((...args: unknown[]) => { clearTimeout(timeout); client.end(); reject(new Error(String(args))); });
  });
}

// --- Tool: get_price ---
server.registerTool("get_price", {
  title: "Get Stock Price",
  description: "Get current price and basic info for a stock. Use TradingView symbol format (e.g. NASDAQ:TSLA, TWSE:2330)",
  inputSchema: { symbol: z.string().describe("TradingView symbol, e.g. NASDAQ:TSLA") },
}, async ({ symbol }) => {
  const data = await fetchStock(symbol, "1D", 20);
  const last = data.periods[data.periods.length - 1];
  const prev = data.periods[data.periods.length - 2];
  const change = last.close - prev.close;
  const changePct = (change / prev.close * 100).toFixed(2);
  return {
    content: [{ type: "text", text: JSON.stringify({
      symbol: data.symbol, name: data.name,
      price: last.close, change, changePct: +changePct,
      open: last.open, high: last.high, low: last.low,
      volume: last.volume, time: last.time,
    }, null, 2) }],
  };
});

// --- Tool: get_indicators ---
server.registerTool("get_indicators", {
  title: "Get Technical Indicators",
  description: "Get MACD, RSI, KDJ, MA, volume status and risk score for a stock",
  inputSchema: { symbol: z.string(), timeframe: z.string().default("1D").describe("1, 5, 15, 60, 1D, 1W") },
}, async ({ symbol, timeframe }) => {
  const data = await fetchStock(symbol, timeframe);
  const indicators = getIndicatorSummary(data.periods);
  const risk = calcRiskScore(data.periods);
  return {
    content: [{ type: "text", text: JSON.stringify({ symbol: data.symbol, timeframe, risk, indicators }, null, 2) }],
  };
});

// --- Tool: get_analysis ---
server.registerTool("get_analysis", {
  title: "Get Full Stock Analysis",
  description: "Get deep technical analysis including trend, institutional intent, trade strategy, risk assessment, and future scenarios",
  inputSchema: {
    symbol: z.string().describe("TradingView symbol"),
    lang: z.enum(["zh-TW", "en"]).default("zh-TW"),
  },
}, async ({ symbol, lang }) => {
  const data = await fetchStock(symbol);
  const indicators = getIndicatorSummary(data.periods);
  const risk = calcRiskScore(data.periods);
  const levels = calcSupportResistance(data.periods);
  const plan = calcTradePlan(data.periods, levels);
  // Import the analysis generator dynamically to avoid circular deps
  const { generateFullAnalysis } = await import("../lib/analysis");
  const analysis = generateFullAnalysis(data.periods, indicators, risk, levels, plan, lang);
  return { content: [{ type: "text", text: analysis }] };
});

// --- Tool: get_levels ---
server.registerTool("get_levels", {
  title: "Get Support/Resistance Levels",
  description: "Get key support and resistance price levels with trade plan (entry, stop-loss, targets)",
  inputSchema: { symbol: z.string() },
}, async ({ symbol }) => {
  const data = await fetchStock(symbol);
  const levels = calcSupportResistance(data.periods);
  const plan = calcTradePlan(data.periods, levels);
  return {
    content: [{ type: "text", text: JSON.stringify({
      symbol: data.symbol, price: data.periods[data.periods.length - 1].close,
      supports: levels.filter(l => l.type === "support").slice(0, 5),
      resistances: levels.filter(l => l.type === "resistance").slice(0, 5),
      tradePlan: plan,
    }, null, 2) }],
  };
});

// --- Tool: search_stocks ---
server.registerTool("search_stocks", {
  title: "Search Stocks",
  description: "Search for stock symbols by name or ticker",
  inputSchema: { query: z.string().describe("Search query, e.g. 'tesla' or 'TSLA'") },
}, async ({ query }) => {
  const TradingView = await import("@mathieuc/tradingview");
  const results = await (TradingView as any).searchMarket(query);
  const top = (results as Array<Record<string, string>>).slice(0, 10).map(r => ({
    symbol: r.id || r.symbol, name: r.description, exchange: r.exchange, type: r.type,
  }));
  return { content: [{ type: "text", text: JSON.stringify(top, null, 2) }] };
});

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main();
