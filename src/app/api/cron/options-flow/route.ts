import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";

// GET /api/cron/options-flow — detect unusual options activity as leading indicator
// Signals: unusual volume, put/call ratio shifts, large OI changes, vol skew
// Uses Yahoo Finance options chain data (free, no additional API key needed)

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

interface OptionsChain {
  calls: OptionContract[];
  puts: OptionContract[];
  expirationDate: number;
}

interface OptionContract {
  strike: number;
  lastPrice: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  inTheMoney: boolean;
}

interface FlowSignal {
  symbol: string;
  signal: "BULLISH_FLOW" | "BEARISH_FLOW" | "UNUSUAL_ACTIVITY" | "SMART_MONEY_CALL" | "PROTECTIVE_PUTS" | "NEUTRAL";
  strength: number; // 0-100
  details: {
    putCallRatio: number;
    totalCallVolume: number;
    totalPutVolume: number;
    unusualStrikes: { strike: number; type: "call" | "put"; volume: number; oi: number; ratio: number }[];
    ivSkew: number; // positive = puts more expensive (bearish skew)
    nearTermExpiry: string;
    maxPainStrike: number | null;
  };
  reasoning: string;
}

async function fetchOptionsChain(symbol: string): Promise<{ chains: OptionsChain[]; currentPrice: number } | null> {
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

    // Get available expiration dates
    const optionsData = await yf.options(symbol);
    if (!optionsData || !optionsData.options || optionsData.options.length === 0) return null;

    const currentPrice = optionsData.quote?.regularMarketPrice || 0;
    const chains: OptionsChain[] = [];

    // Process the first expiration (nearest term — most informative for flow)
    for (const opt of optionsData.options.slice(0, 3)) {
      const calls: OptionContract[] = (opt.calls || []).map((c: Record<string, unknown>) => ({
        strike: (c.strike as number) || 0,
        lastPrice: (c.lastPrice as number) || 0,
        bid: (c.bid as number) || 0,
        ask: (c.ask as number) || 0,
        volume: (c.volume as number) || 0,
        openInterest: (c.openInterest as number) || 0,
        impliedVolatility: (c.impliedVolatility as number) || 0,
        inTheMoney: (c.inTheMoney as boolean) || false,
      }));

      const puts: OptionContract[] = (opt.puts || []).map((p: Record<string, unknown>) => ({
        strike: (p.strike as number) || 0,
        lastPrice: (p.lastPrice as number) || 0,
        bid: (p.bid as number) || 0,
        ask: (p.ask as number) || 0,
        volume: (p.volume as number) || 0,
        openInterest: (p.openInterest as number) || 0,
        impliedVolatility: (p.impliedVolatility as number) || 0,
        inTheMoney: (p.inTheMoney as boolean) || false,
      }));

      chains.push({ calls, puts, expirationDate: opt.expirationDate ? new Date(opt.expirationDate).getTime() / 1000 : 0 });
    }

    return { chains, currentPrice };
  } catch {
    return null;
  }
}

function analyzeFlow(symbol: string, chains: OptionsChain[], currentPrice: number): FlowSignal {
  if (chains.length === 0) {
    return { symbol, signal: "NEUTRAL", strength: 0, details: { putCallRatio: 0, totalCallVolume: 0, totalPutVolume: 0, unusualStrikes: [], ivSkew: 0, nearTermExpiry: "N/A", maxPainStrike: null }, reasoning: "No options data available" };
  }

  // Aggregate across near-term expirations
  let totalCallVol = 0, totalPutVol = 0;
  let totalCallOI = 0, totalPutOI = 0;
  const unusualStrikes: FlowSignal["details"]["unusualStrikes"] = [];
  let callIVSum = 0, putIVSum = 0, callIVCount = 0, putIVCount = 0;

  for (const chain of chains) {
    for (const c of chain.calls) {
      totalCallVol += c.volume;
      totalCallOI += c.openInterest;
      if (c.impliedVolatility > 0) { callIVSum += c.impliedVolatility; callIVCount++; }

      // Unusual: volume > 5x open interest (someone opening massive new positions)
      if (c.openInterest > 0 && c.volume > c.openInterest * 5 && c.volume > 100) {
        unusualStrikes.push({ strike: c.strike, type: "call", volume: c.volume, oi: c.openInterest, ratio: +(c.volume / c.openInterest).toFixed(1) });
      }
    }
    for (const p of chain.puts) {
      totalPutVol += p.volume;
      totalPutOI += p.openInterest;
      if (p.impliedVolatility > 0) { putIVSum += p.impliedVolatility; putIVCount++; }

      if (p.openInterest > 0 && p.volume > p.openInterest * 5 && p.volume > 100) {
        unusualStrikes.push({ strike: p.strike, type: "put", volume: p.volume, oi: p.openInterest, ratio: +(p.volume / p.openInterest).toFixed(1) });
      }
    }
  }

  const putCallRatio = totalCallVol > 0 ? +(totalPutVol / totalCallVol).toFixed(3) : 0;
  const avgCallIV = callIVCount > 0 ? callIVSum / callIVCount : 0;
  const avgPutIV = putIVCount > 0 ? putIVSum / putIVCount : 0;
  const ivSkew = +((avgPutIV - avgCallIV) * 100).toFixed(2); // positive = bearish skew

  // Calculate max pain (strike where most options expire worthless)
  let maxPainStrike: number | null = null;
  if (chains[0]) {
    const strikes = new Set<number>();
    chains[0].calls.forEach(c => strikes.add(c.strike));
    chains[0].puts.forEach(p => strikes.add(p.strike));
    let minPain = Infinity;
    for (const strike of strikes) {
      let pain = 0;
      for (const c of chains[0].calls) {
        if (strike > c.strike) pain += (strike - c.strike) * c.openInterest;
      }
      for (const p of chains[0].puts) {
        if (strike < p.strike) pain += (p.strike - strike) * p.openInterest;
      }
      if (pain < minPain) { minPain = pain; maxPainStrike = strike; }
    }
  }

  // Determine signal
  let signal: FlowSignal["signal"] = "NEUTRAL";
  let strength = 0;
  let reasoning = "";

  const unusualCallStrikes = unusualStrikes.filter(s => s.type === "call");
  const unusualPutStrikes = unusualStrikes.filter(s => s.type === "put");

  // Smart money calls: large call volume above current price (bullish bets)
  const abovePriceCalls = unusualCallStrikes.filter(s => s.strike > currentPrice * 1.05);
  if (abovePriceCalls.length >= 2 && putCallRatio < 0.7) {
    signal = "SMART_MONEY_CALL";
    strength = Math.min(95, 60 + abovePriceCalls.length * 10);
    reasoning = `${abovePriceCalls.length} unusual call strikes above price (${abovePriceCalls.map(s => `$${s.strike}`).join(", ")}), low P/C ratio ${putCallRatio}`;
  }
  // Bullish flow: low put/call ratio + high call volume
  else if (putCallRatio < 0.5 && totalCallVol > 1000) {
    signal = "BULLISH_FLOW";
    strength = Math.min(85, 50 + Math.round((0.5 - putCallRatio) * 100));
    reasoning = `Very low P/C ratio ${putCallRatio} with ${totalCallVol.toLocaleString()} call volume — bullish positioning`;
  }
  // Protective puts: high put volume relative to call, especially ITM puts
  else if (putCallRatio > 1.5 && totalPutVol > 1000) {
    signal = "PROTECTIVE_PUTS";
    strength = Math.min(85, 50 + Math.round((putCallRatio - 1.5) * 30));
    reasoning = `High P/C ratio ${putCallRatio} with ${totalPutVol.toLocaleString()} put volume — hedging/bearish`;
  }
  // Bearish flow: high put/call + negative skew
  else if (putCallRatio > 1.2 && ivSkew > 5) {
    signal = "BEARISH_FLOW";
    strength = Math.min(80, 40 + Math.round(putCallRatio * 15 + ivSkew));
    reasoning = `Elevated P/C ${putCallRatio} + put IV skew ${ivSkew}% — market pricing downside`;
  }
  // General unusual activity
  else if (unusualStrikes.length >= 3) {
    signal = "UNUSUAL_ACTIVITY";
    strength = Math.min(70, 40 + unusualStrikes.length * 8);
    reasoning = `${unusualStrikes.length} strikes with vol/OI > 5x — institutional positioning detected`;
  }
  // Low-signal but some activity
  else if (totalCallVol + totalPutVol > 500) {
    strength = 30;
    reasoning = `Normal flow. P/C=${putCallRatio}, IV skew=${ivSkew}%`;
  } else {
    reasoning = "Low options volume — insufficient signal";
  }

  const nearTermExpiry = chains[0]?.expirationDate
    ? new Date(chains[0].expirationDate * 1000).toISOString().split("T")[0]
    : "N/A";

  return {
    symbol, signal, strength,
    details: {
      putCallRatio, totalCallVolume: totalCallVol, totalPutVolume: totalPutVol,
      unusualStrikes: unusualStrikes.sort((a, b) => b.ratio - a.ratio).slice(0, 5),
      ivSkew, nearTermExpiry, maxPainStrike,
    },
    reasoning,
  };
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const symbol = req.nextUrl.searchParams.get("symbol");
  const supabase = trySupabase();

  // Get symbols to scan
  let symbols: string[] = symbol ? [symbol] : [];
  if (symbols.length === 0 && supabase) {
    const { data } = await supabase.from("watchlists").select("symbol").eq("active", true);
    symbols = (data || []).map((r: { symbol: string }) => r.symbol);
  }
  if (symbols.length === 0) symbols = (process.env.WATCHLIST || "NASDAQ:NVDA").split(",");

  const results: FlowSignal[] = [];

  for (const sym of symbols.slice(0, 10)) {
    const raw = sym.includes(":") ? sym.split(":")[1] : sym;
    // Options only work for US stocks on Yahoo Finance
    if (sym.startsWith("TWSE:")) continue;
    const yahoo = raw;

    const chainData = await fetchOptionsChain(yahoo);
    if (!chainData) continue;

    const flow = analyzeFlow(raw, chainData.chains, chainData.currentPrice);
    results.push(flow);
  }

  const actionable = results.filter(r => r.signal !== "NEUTRAL" && r.strength >= 50);
  actionable.sort((a, b) => b.strength - a.strength);

  const bullish = results.filter(r => r.signal === "BULLISH_FLOW" || r.signal === "SMART_MONEY_CALL");
  const bearish = results.filter(r => r.signal === "BEARISH_FLOW" || r.signal === "PROTECTIVE_PUTS");

  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    scanned: results.length,
    actionableCount: actionable.length,
    signals: actionable,
    all: results,
    summary: actionable.length > 0
      ? `📊 Options flow: ${bullish.length} bullish, ${bearish.length} bearish | Top: ${actionable[0]?.symbol} (${actionable[0]?.signal}, ${actionable[0]?.strength}%)`
      : "⚪ No significant options flow detected",
    marketSentiment: bullish.length > bearish.length ? "BULLISH" : bearish.length > bullish.length ? "BEARISH" : "MIXED",
  });
}
