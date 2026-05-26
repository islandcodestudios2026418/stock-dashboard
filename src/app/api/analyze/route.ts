import { NextRequest, NextResponse } from "next/server";
import { OHLCV, getIndicatorSummary, calcRiskScore } from "@/lib/indicators";
import { calcSupportResistance, calcTradePlan } from "@/lib/levels";
import { generateFullAnalysis } from "@/lib/analysis";

export async function POST(req: NextRequest) {
  const { periods, lang = "zh-TW" } = await req.json() as {
    symbol: string; name: string; periods: OHLCV[]; lang?: string;
  };

  if (!periods || periods.length < 20) {
    return NextResponse.json({ error: "Not enough data" }, { status: 400 });
  }

  const indicators = getIndicatorSummary(periods);
  const riskScore = calcRiskScore(periods);
  const levels = calcSupportResistance(periods);
  const tradePlan = calcTradePlan(periods, levels);
  const analysis = generateFullAnalysis(periods, indicators, riskScore, levels, tradePlan, lang);

  return NextResponse.json({ analysis, levels, tradePlan, riskScore });
}
