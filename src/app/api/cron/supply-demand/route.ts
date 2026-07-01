import { NextRequest, NextResponse } from "next/server";
import { trySupabase } from "@/lib/supabase";
import { calcEMA, type OHLCV } from "@/lib/indicators";

// GET /api/cron/supply-demand — THE SNDK core pattern detector
// SNDK pattern = mature company + supply constraint + demand surge + catalyst
//
// What made SNDK go 3500%:
// 1. Industry consolidated (fewer competitors)
// 2. Supply was CUT (NAND fabs reduced capex)
// 3. Demand SURGED (mobile/cloud explosion)
// 4. Company had pricing power (oligopoly)
//
// This endpoint detects these conditions using:
// - Sector concentration analysis (ETF vs individual stock divergence)
// - Capex reduction signals (from price patterns of suppliers)
// - Demand acceleration (revenue/volume growth patterns)
// - Pricing power indicators (margin expansion via price action)

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || secret === CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

interface SupplyDemandSignal {
  symbol: string;
  score: number; // 0-100 SNDK-pattern match
  components: {
    supplyConstraint: number; // 0-25: evidence of supply reduction
    demandSurge: number; // 0-25: evidence of demand acceleration
    consolidation: number; // 0-25: industry concentration / oligopoly
    pricingPower: number; // 0-25: margin expansion / outperformance
  };
  phase: "EARLY_ACCUMULATION" | "SUPPLY_TIGHTENING" | "DEMAND_INFLECTION" | "MARKUP_BEGINS" | "NO_PATTERN";
  triggers: string[];
  reasoning: string;
}

// Sector ETFs for comparison (to detect stock vs sector divergence)
const SECTOR_BENCHMARKS: Record<string, string> = {
  NVDA: "SMH", AMD: "SMH", INTC: "SMH", AVGO: "SMH", QCOM: "SMH", MU: "SMH", MRVL: "SMH",
  AAPL: "XLK", MSFT: "XLK", GOOG: "XLK", META: "XLK", CRM: "XLK",
  XOM: "XLE", CVX: "XLE", SLB: "XLE", OXY: "XLE",
  LLY: "XLV", UNH: "XLV", JNJ: "XLV", PFE: "XLV",
  JPM: "XLF", BAC: "XLF", GS: "XLF",
  TSLA: "CARZ", RIVN: "CARZ",
  CAT: "XLI", DE: "XLI", RTX: "XLI",
};

async function fetchChart(symbol: string, days: number = 250): Promise<OHLCV[]> {
  const mod = await import("yahoo-finance2");
  const YahooFinance = mod.default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  const period1 = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
  const result = await yf.chart(symbol, { period1, interval: "1d" });
  return (result.quotes || []).filter(q => q.close != null).map(q => ({
    time: Math.floor(new Date(q.date).getTime() / 1000),
    open: q.open!, high: q.high!, low: q.low!, close: q.close!, volume: q.volume || 0,
  }));
}

function analyzeSupplyDemand(symbol: string, stockData: OHLCV[], sectorData: OHLCV[] | null): SupplyDemandSignal {
  const n = stockData.length;
  if (n < 120) {
    return { symbol, score: 0, components: { supplyConstraint: 0, demandSurge: 0, consolidation: 0, pricingPower: 0 }, phase: "NO_PATTERN", triggers: [], reasoning: "Insufficient data (need 120+ days)" };
  }

  const closes = stockData.map(d => d.close);
  const volumes = stockData.map(d => d.volume);
  const triggers: string[] = [];

  // === 1. SUPPLY CONSTRAINT SIGNALS (0-25) ===
  // Supply tightening shows as: declining volume over time (less shares available),
  // narrowing range (less selling pressure), quiet consolidation
  let supplyScore = 0;

  // Volume declining over 60d while price stable/rising = supply drying up
  const vol30d = volumes.slice(-30).reduce((a, b) => a + b, 0) / 30;
  const vol90d = volumes.slice(-90, -30).reduce((a, b) => a + b, 0) / 60;
  const volDecline = vol90d > 0 ? (vol30d - vol90d) / vol90d : 0;
  if (volDecline < -0.3 && closes[n - 1] >= closes[n - 60]) {
    supplyScore += 10;
    triggers.push(`Volume declined ${(volDecline * 100).toFixed(0)}% while price held — supply absorbed`);
  }

  // Tight consolidation (low ATR relative to price) = sellers exhausted
  const atr14: number[] = [];
  for (let i = 14; i < n; i++) {
    let sum = 0;
    for (let j = i - 14; j < i; j++) {
      const tr = Math.max(stockData[j + 1].high - stockData[j + 1].low, Math.abs(stockData[j + 1].high - stockData[j].close), Math.abs(stockData[j + 1].low - stockData[j].close));
      sum += tr;
    }
    atr14.push(sum / 14);
  }
  const currentATRPct = atr14.length > 0 ? (atr14[atr14.length - 1] / closes[n - 1]) * 100 : 5;
  const avgATRPct = atr14.length > 30 ? (atr14.slice(-60, -20).reduce((a, b) => a + b, 0) / 40 / closes[n - 30]) * 100 : currentATRPct;
  if (currentATRPct < avgATRPct * 0.6) {
    supplyScore += 8;
    triggers.push(`ATR compressed to ${currentATRPct.toFixed(2)}% vs avg ${avgATRPct.toFixed(2)}% — volatility squeeze (supply/demand equilibrium)`);
  }

  // Stock building a base (sideways 60d+ with rising lows) = accumulation
  const last60 = closes.slice(-60);
  const range60 = (Math.max(...last60) - Math.min(...last60)) / closes[n - 1];
  const risingLows = last60.slice(30).every((_, i, arr) => i === 0 || Math.min(...arr.slice(0, i + 1)) >= Math.min(...last60.slice(0, 30)) * 0.98);
  if (range60 < 0.15 && risingLows) {
    supplyScore += 7;
    triggers.push(`Base building: 60d range ${(range60 * 100).toFixed(1)}% with rising lows — supply constrained`);
  }

  supplyScore = Math.min(25, supplyScore);

  // === 2. DEMAND SURGE SIGNALS (0-25) ===
  // Demand acceleration: recent volume spikes on up days, accelerating up-moves
  let demandScore = 0;

  // Volume surge on up days (last 20d)
  let upDayVol = 0, downDayVol = 0, upDays = 0, downDays = 0;
  for (let i = n - 20; i < n; i++) {
    if (stockData[i].close > stockData[i - 1].close) { upDayVol += volumes[i]; upDays++; }
    else { downDayVol += volumes[i]; downDays++; }
  }
  const avgUpVol = upDays > 0 ? upDayVol / upDays : 0;
  const avgDownVol = downDays > 0 ? downDayVol / downDays : 1;
  const upDownRatio = avgUpVol / avgDownVol;
  if (upDownRatio > 2.0) {
    demandScore += 10;
    triggers.push(`Demand surge: up-day volume ${upDownRatio.toFixed(1)}x down-day volume (last 20d)`);
  } else if (upDownRatio > 1.5) {
    demandScore += 5;
  }

  // Price acceleration: 20d return > 2x 60d return rate
  const ret20d = (closes[n - 1] - closes[n - 20]) / closes[n - 20];
  const ret60d = (closes[n - 1] - closes[n - 60]) / closes[n - 60];
  const dailyRate20 = ret20d / 20;
  const dailyRate60 = ret60d / 60;
  if (dailyRate20 > dailyRate60 * 2 && ret20d > 0.05) {
    demandScore += 8;
    triggers.push(`Price accelerating: 20d rate ${(dailyRate20 * 100).toFixed(3)}%/day vs 60d ${(dailyRate60 * 100).toFixed(3)}%/day`);
  }

  // Breakout from base on volume
  const high60d = Math.max(...closes.slice(-60, -5));
  const breakingOut = closes[n - 1] > high60d * 1.02;
  const breakoutVol = vol30d > vol90d * 1.3;
  if (breakingOut && breakoutVol) {
    demandScore += 7;
    triggers.push(`Breaking out above 60d high ($${high60d.toFixed(2)}) on elevated volume — demand confirmed`);
  }

  demandScore = Math.min(25, demandScore);

  // === 3. CONSOLIDATION / OLIGOPOLY SIGNALS (0-25) ===
  // Stock outperforming its sector (market share gains in concentrated industry)
  let consolidationScore = 0;

  if (sectorData && sectorData.length >= 120) {
    const sectorCloses = sectorData.map(d => d.close);
    const minLen = Math.min(closes.length, sectorCloses.length);

    // 60d relative performance: stock vs sector
    const stockRet60 = (closes[n - 1] - closes[n - Math.min(60, minLen)]) / closes[n - Math.min(60, minLen)];
    const sn = sectorCloses.length;
    const sectorRet60 = (sectorCloses[sn - 1] - sectorCloses[sn - Math.min(60, minLen)]) / sectorCloses[sn - Math.min(60, minLen)];
    const outperformance = stockRet60 - sectorRet60;

    if (outperformance > 0.15) {
      consolidationScore += 12;
      triggers.push(`Outperforming sector by ${(outperformance * 100).toFixed(1)}% over 60d — market share gains / pricing power`);
    } else if (outperformance > 0.08) {
      consolidationScore += 6;
    }

    // Stock making new highs while sector flat/down = divergence (winner takes all)
    const stockAtHigh = closes[n - 1] >= Math.max(...closes.slice(-120)) * 0.95;
    const sectorBelow = sectorCloses[sn - 1] < Math.max(...sectorCloses.slice(-120)) * 0.9;
    if (stockAtHigh && sectorBelow) {
      consolidationScore += 10;
      triggers.push(`Stock near highs while sector lagging — industry consolidation (winner-take-all)`);
    }

    // Decreasing correlation with sector (becoming a leader, not follower)
    const corr30 = calcCorrelation(closes.slice(-30), sectorCloses.slice(-30));
    const corr90 = calcCorrelation(closes.slice(-90), sectorCloses.slice(-90));
    if (corr30 < corr90 - 0.15 && corr30 < 0.7) {
      consolidationScore += 5;
      triggers.push(`Decoupling from sector (corr: ${corr30.toFixed(2)} vs ${corr90.toFixed(2)}) — independent momentum`);
    }
  } else {
    // No sector data — use self-referential signals
    // Consistent new highs over 120d
    let newHighCount = 0;
    for (let i = n - 60; i < n; i++) {
      if (closes[i] >= Math.max(...closes.slice(0, i))) newHighCount++;
    }
    if (newHighCount >= 10) {
      consolidationScore += 8;
      triggers.push(`${newHighCount} new all-time highs in 60d — dominant position`);
    }
  }

  consolidationScore = Math.min(25, consolidationScore);

  // === 4. PRICING POWER (0-25) ===
  // Higher highs with lower volume = effortless advance (pricing power)
  let pricingScore = 0;

  // EMA spread widening (strong trend with no mean reversion)
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const emaSpread = ema21[n - 1] > 0 && ema50[n - 1] > 0 ? (ema21[n - 1] - ema50[n - 1]) / ema50[n - 1] : 0;
  const emaSpread30d = ema21[n - 30] > 0 && ema50[n - 30] > 0 ? (ema21[n - 30] - ema50[n - 30]) / ema50[n - 30] : 0;
  if (emaSpread > emaSpread30d && emaSpread > 0.03) {
    pricingScore += 8;
    triggers.push(`EMA spread widening (${(emaSpread * 100).toFixed(1)}% vs ${(emaSpread30d * 100).toFixed(1)}%) — trend accelerating`);
  }

  // Effortless advance: price up on declining volume = no resistance
  const priceUp30d = closes[n - 1] > closes[n - 30];
  const volDown30d = vol30d < vol90d * 0.8;
  if (priceUp30d && volDown30d) {
    pricingScore += 8;
    triggers.push(`Price rising on declining volume — effortless advance (no sellers)`);
  }

  // Strong candles: large green candles with small wicks (conviction)
  let strongGreenDays = 0;
  for (let i = n - 20; i < n; i++) {
    const body = stockData[i].close - stockData[i].open;
    const range = stockData[i].high - stockData[i].low;
    if (body > 0 && range > 0 && body / range > 0.6 && body / stockData[i].close > 0.01) {
      strongGreenDays++;
    }
  }
  if (strongGreenDays >= 8) {
    pricingScore += 9;
    triggers.push(`${strongGreenDays}/20 strong green candles (body >60% of range) — persistent buying pressure`);
  } else if (strongGreenDays >= 5) {
    pricingScore += 4;
  }

  pricingScore = Math.min(25, pricingScore);

  // === TOTAL SCORE & PHASE ===
  const score = supplyScore + demandScore + consolidationScore + pricingScore;

  let phase: SupplyDemandSignal["phase"] = "NO_PATTERN";
  if (score >= 60 && demandScore >= 15 && supplyScore >= 10) phase = "MARKUP_BEGINS";
  else if (demandScore >= 15 && supplyScore < 10) phase = "DEMAND_INFLECTION";
  else if (supplyScore >= 15 && demandScore < 10) phase = "SUPPLY_TIGHTENING";
  else if (supplyScore >= 8 && consolidationScore >= 8) phase = "EARLY_ACCUMULATION";

  const reasoning = score >= 50
    ? `Strong SNDK-pattern match: ${phase}. Key: ${triggers.slice(0, 3).join("; ")}`
    : score >= 30
    ? `Partial SNDK pattern (${phase}): ${triggers.slice(0, 2).join("; ")}`
    : `Low pattern match. ${triggers.length > 0 ? triggers[0] : "No significant supply-demand imbalance detected."}`;

  return {
    symbol, score,
    components: { supplyConstraint: supplyScore, demandSurge: demandScore, consolidation: consolidationScore, pricingPower: pricingScore },
    phase, triggers, reasoning,
  };
}

function calcCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 10) return 0;
  const aSlice = a.slice(-n), bSlice = b.slice(-n);
  const meanA = aSlice.reduce((s, v) => s + v, 0) / n;
  const meanB = bSlice.reduce((s, v) => s + v, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = aSlice[i] - meanA, db = bSlice[i] - meanB;
    num += da * db; denA += da * da; denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : 0;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const symbol = req.nextUrl.searchParams.get("symbol");
  const supabase = trySupabase();

  let symbols: string[] = symbol ? [symbol] : [];
  if (symbols.length === 0 && supabase) {
    const { data } = await supabase.from("watchlists").select("symbol").eq("active", true);
    symbols = (data || []).map((r: { symbol: string }) => r.symbol);
  }
  if (symbols.length === 0) symbols = (process.env.WATCHLIST || "NASDAQ:NVDA").split(",");

  const results: SupplyDemandSignal[] = [];

  for (const sym of symbols.slice(0, 15)) {
    try {
      const raw = sym.includes(":") ? sym.split(":")[1] : sym;
      const yahoo = sym.startsWith("TWSE:") ? `${raw}.TW` : raw;
      const stockData = await fetchChart(yahoo, 250);
      if (stockData.length < 120) continue;

      // Fetch sector benchmark for comparison
      let sectorData: OHLCV[] | null = null;
      const benchmark = SECTOR_BENCHMARKS[raw];
      if (benchmark) {
        try {
          sectorData = await fetchChart(benchmark, 250);
        } catch { /* non-critical */ }
      }

      const result = analyzeSupplyDemand(raw, stockData, sectorData);
      results.push(result);
    } catch { /* skip */ }
  }

  results.sort((a, b) => b.score - a.score);

  const strong = results.filter(r => r.score >= 50);
  const emerging = results.filter(r => r.score >= 30 && r.score < 50);

  return NextResponse.json({
    date: new Date().toISOString().split("T")[0],
    scanned: results.length,
    strongPatterns: strong,
    emergingPatterns: emerging,
    all: results,
    summary: strong.length > 0
      ? `🏭 SNDK-pattern: ${strong.map(r => `${r.symbol}(${r.score}/100, ${r.phase})`).join(", ")}`
      : emerging.length > 0
      ? `📊 Emerging: ${emerging.map(r => `${r.symbol}(${r.score})`).join(", ")}`
      : "⚪ No supply-demand imbalance detected",
    methodology: "Supply(25) + Demand(25) + Consolidation(25) + PricingPower(25) = 100. Score≥50 = strong SNDK match.",
  });
}
