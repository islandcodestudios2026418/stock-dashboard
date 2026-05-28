import { NextRequest, NextResponse } from "next/server";
import { OHLCV, getIndicatorSummary, calcRiskScore } from "@/lib/indicators";
import { calcSupportResistance, calcTradePlan } from "@/lib/levels";
import { promises as fs } from "fs";
import path from "path";

// Daily cache: "SYMBOL:DATE" → result
const cache = new Map<string, { result: string; ts: number }>();
function todayKey(symbol: string) {
  const d = new Date();
  return `${symbol}:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const SYSTEM_PROMPT = `你是專業技術分析師。根據提供的數據，輸出分析結果。

格式要求：必須用以下 markdown 結構（用 ## 開頭分段），網頁會自動把每個 ## 段落顯示在獨立的框裡：

## 行情說明
### 大趨勢：[判斷]
[一段描述，包含均線位置、布林通道、MACD狀態]
### 今日K線性質：[描述]
[量價分析]
### 短線結構：[判斷]
[DIF/DEA分析]
### 關鍵支撐：[價位]
[支撐理由]

## 主力意圖（深度解析）
### 主力核心目標
- [目標1]
- [目標2]
- [目標3]
### 洗盤特徵
① [特徵1]
① [特徵2]
### 主力操作路徑
① [步驟1]
① [步驟2]
① [步驟3]
### 主力控盤程度
[用█和░組成的進度條] [強度] [百分比]%

## 交易策略建議
### 情況1：已持倉
**[建議標題]**
[具體策略和價位]
### 情況2：想加倉
**[建議標題]**
[具體進場價、停損、止盈]
### 止損與風控
[止損條件]
[質性改變條件]
[嚴格止損條件]

## 風險評估
### 風險因素
● [風險1]
● [風險2]
### 但未到牛轉熊
◎ [正面因素1]
◎ [正面因素2]

## 未來劇本
### 劇本A（[機率]%）[標題]
[路徑描述]
★★★★☆
### 劇本B（[機率]%）[標題]
[路徑描述]
★★☆☆☆

## 關鍵關注點
① [關注點1]
① [關注點2]
① [關注點3]
① [關注點4]

規則：
- 禁止建議「等回到X」如果X遠低於現價>10%
- R:R必須≥1.5，停損距離3-15%
- 每個結論附數據依據
- 繁體中文，簡潔有力
- 加倉建議的價位必須合理（接近現價或在合理回測範圍內）`;

function buildDataPrompt(symbol: string, periods: OHLCV[]) {
  const indicators = getIndicatorSummary(periods);
  const riskScore = calcRiskScore(periods);
  const levels = calcSupportResistance(periods);
  const tradePlan = calcTradePlan(periods, levels);
  const last = periods[periods.length - 1];
  const prev = periods[periods.length - 2];
  const changePct = ((last.close - prev.close) / prev.close * 100).toFixed(2);

  return `股票：${symbol}
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
}

// --- Provider: Anthropic ---
async function callAnthropic(apiKey: string, dataPrompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-opus-4-0", max_tokens: 2000, system: SYSTEM_PROMPT, messages: [{ role: "user", content: dataPrompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text || "No response";
}

// --- Provider: OpenAI ---
async function callOpenAI(apiKey: string, dataPrompt: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o", max_tokens: 2000, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: dataPrompt }] }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "No response";
}

// --- Provider: Google Gemini ---
async function callGemini(apiKey: string, dataPrompt: string): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system_instruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents: [{ parts: [{ text: dataPrompt }] }] }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
}

// --- Provider: kiro-cli (polling) ---
const REQUESTS_DIR = path.join(process.cwd(), ".ai-requests");
const RESULTS_DIR = path.join(process.cwd(), ".ai-results");

async function callKiroCli(symbol: string, dataPrompt: string): Promise<string> {
  await fs.mkdir(REQUESTS_DIR, { recursive: true });
  await fs.mkdir(RESULTS_DIR, { recursive: true });

  const id = `${symbol.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
  const requestFile = path.join(REQUESTS_DIR, `${id}.json`);
  const resultFile = path.join(RESULTS_DIR, `${id}.json`);

  // Write request for kiro-cli watcher to pick up
  await fs.writeFile(requestFile, JSON.stringify({ id, symbol, system: SYSTEM_PROMPT, prompt: dataPrompt, ts: Date.now() }));

  // Poll for result (max 90 seconds)
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const raw = await fs.readFile(resultFile, "utf-8");
      const result = JSON.parse(raw);
      // Cleanup
      await fs.unlink(requestFile).catch(() => {});
      await fs.unlink(resultFile).catch(() => {});
      return result.analysis || "No response from kiro-cli";
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 2000));
  }

  // Timeout - cleanup request
  await fs.unlink(requestFile).catch(() => {});
  throw new Error("kiro-cli analysis timeout (90s). Is the watcher running?");
}

export async function POST(req: NextRequest) {
  const { symbol, periods, provider = "kiro", apiKey } = await req.json() as {
    symbol: string; periods: OHLCV[]; provider?: "anthropic" | "openai" | "gemini" | "kiro"; apiKey?: string;
  };

  if (!periods || periods.length < 20) {
    return NextResponse.json({ error: "Not enough data" }, { status: 400 });
  }

  // Check cache
  const key = todayKey(symbol);
  const cached = cache.get(key);
  if (cached) {
    return NextResponse.json({ analysis: cached.result, cached: true, provider });
  }

  const dataPrompt = buildDataPrompt(symbol, periods);

  try {
    let analysis: string;

    switch (provider) {
      case "anthropic":
        if (!apiKey) return NextResponse.json({ error: "請提供 Anthropic API Key" }, { status: 400 });
        analysis = await callAnthropic(apiKey, dataPrompt);
        break;
      case "openai":
        if (!apiKey) return NextResponse.json({ error: "請提供 OpenAI API Key" }, { status: 400 });
        analysis = await callOpenAI(apiKey, dataPrompt);
        break;
      case "gemini":
        if (!apiKey) return NextResponse.json({ error: "請提供 Google Gemini API Key" }, { status: 400 });
        analysis = await callGemini(apiKey, dataPrompt);
        break;
      case "kiro":
      default:
        analysis = await callKiroCli(symbol, dataPrompt);
        break;
    }

    cache.set(key, { result: analysis, ts: Date.now() });
    return NextResponse.json({ analysis, cached: false, provider });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
