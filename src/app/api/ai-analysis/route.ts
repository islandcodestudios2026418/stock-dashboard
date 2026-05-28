import { NextRequest, NextResponse } from "next/server";
import { OHLCV, getIndicatorSummary, calcRiskScore } from "@/lib/indicators";
import { calcSupportResistance, calcTradePlan } from "@/lib/levels";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

// In-memory daily cache: key = "SYMBOL:DATE" → analysis result
const cache = new Map<string, { result: string; ts: number }>();

function todayKey(symbol: string) {
  const d = new Date();
  return `${symbol}:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const SYSTEM_PROMPT = `你是專業技術分析師。根據提供的數據，按以下框架輸出分析：

## 現況定位
一段話描述：價格vs均線位置、趨勢方向、量能狀態

## 多空論證
**多方證據：**（列出具體指標數值和解讀）
**空方證據：**（列出具體指標數值和解讀）
**權重判斷：**哪邊更強

## 操作建議
**已持倉：**持有/減倉條件和價位
**想進場：**進場價位、停損、目標、R:R
**觀望信號：**什麼出現才行動

## 風險提醒
用🔴🟡🟢標記

規則：
- 禁止建議「等回到X」如果X遠低於現價>10%
- R:R必須≥1.5
- 停損距離3-15%
- 每個結論附數據依據
- 繁體中文，簡潔有力`;

export async function POST(req: NextRequest) {
  const { symbol, periods, lang = "zh-TW" } = await req.json() as {
    symbol: string; periods: OHLCV[]; lang?: string;
  };

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  if (!periods || periods.length < 20) {
    return NextResponse.json({ error: "Not enough data" }, { status: 400 });
  }

  // Check cache
  const key = todayKey(symbol);
  const cached = cache.get(key);
  if (cached) {
    return NextResponse.json({ analysis: cached.result, cached: true });
  }

  // Compute indicators
  const indicators = getIndicatorSummary(periods);
  const riskScore = calcRiskScore(periods);
  const levels = calcSupportResistance(periods);
  const tradePlan = calcTradePlan(periods, levels);
  const last = periods[periods.length - 1];
  const prev = periods[periods.length - 2];
  const changePct = ((last.close - prev.close) / prev.close * 100).toFixed(2);

  // Build data summary for Claude
  const dataPrompt = `股票：${symbol}
現價：${last.close}（${+changePct > 0 ? "+" : ""}${changePct}%）
開：${last.open} 高：${last.high} 低：${last.low} 量：${last.volume}

技術指標（日線）：
- MACD: DIF=${indicators.macd.dif.toFixed(2)}, DEA=${indicators.macd.dea.toFixed(2)}, 柱=${(indicators.macd.dif - indicators.macd.dea).toFixed(2)}, 狀態=${indicators.macd.status}
- RSI(14): ${indicators.rsi.value.toFixed(1)}, 狀態=${indicators.rsi.status}
- KDJ: K=${indicators.kdj.k.toFixed(1)}, D=${indicators.kdj.d.toFixed(1)}, J=${indicators.kdj.j.toFixed(1)}, 狀態=${indicators.kdj.status}
- MA: MA20=${indicators.ma.sma20?.toFixed(2) ?? "N/A"}, 排列=${indicators.ma.status}
- 量能: 今日量/20日均量=${(last.volume / indicators.volume.avg20).toFixed(2)}, 狀態=${indicators.volume.status}

支撐位：${levels.filter(l => l.type === "support").slice(0, 3).map(l => `${l.price.toFixed(2)}(${l.strength},觸碰${l.touches}次)`).join(", ")}
壓力位：${levels.filter(l => l.type === "resistance").slice(0, 3).map(l => `${l.price.toFixed(2)}(${l.strength},觸碰${l.touches}次)`).join(", ")}

交易計劃（規則引擎）：
- 進場：${tradePlan?.entry.toFixed(2) ?? "N/A"}
- 停損：${tradePlan?.stopLoss.toFixed(2) ?? "N/A"}
- 目標1：${tradePlan?.target1.toFixed(2) ?? "N/A"}
- 目標2：${tradePlan?.target2.toFixed(2) ?? "N/A"}
- R:R：${tradePlan?.riskReward ?? "N/A"}

風險分數：${riskScore}/10`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-0",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: dataPrompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Claude API error: ${res.status} ${err}` }, { status: 502 });
    }

    const data = await res.json();
    const analysis = data.content?.[0]?.text || "No response";

    // Cache for today
    cache.set(key, { result: analysis, ts: Date.now() });

    return NextResponse.json({ analysis, cached: false });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
