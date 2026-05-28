# Daily Auto-Analysis Architecture

## Overview

每天美股開盤前，OpenAB 的 cron 自動觸發 kiro-cli 分析自選股清單中的所有股票。
結果存入 Supabase，前端直接讀取 cache，秒開。

## Architecture

```
┌─ Zeabur Container (OpenAB + kiro-cli) ──────────────────────┐
│                                                              │
│  openab (PID 1, 常駐)                                        │
│    ├─ kiro-cli acp --trust-all-tools (子進程)                │
│    │    └─ MCP: stock-analysis server (get_price, etc.)      │
│    │                                                         │
│    └─ 內建 Cron Scheduler                                    │
│         └─ 每天 21:00 台灣時間 (= UTC 13:00)                 │
│              → 發 prompt 給 kiro-cli                          │
│              → kiro-cli 用 MCP tools 抓數據                   │
│              → kiro-cli 用 Opus 4.6 生成深度分析              │
│              → 結果回到 Discord channel                       │
│                                                              │
│  Next.js App (stock-dashboard)                               │
│    └─ /api/cron/daily-analysis                               │
│         → 被 kiro-cli 呼叫（透過 shell tool）                 │
│         → 讀 Supabase watchlist → 回傳股票清單                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─ Supabase (免費) ─────┐    ┌─ Discord Channel ──────┐
│                        │    │                        │
│  watchlists 表          │    │  每日分析結果           │
│  ├─ user_id            │    │  (kiro-cli 回覆)       │
│  ├─ symbols[]          │    │                        │
│  └─ updated_at         │    └────────────────────────┘
│                        │
│  analysis_cache 表      │
│  ├─ symbol             │
│  ├─ date               │
│  ├─ analysis (text)    │
│  ├─ indicators (json)  │
│  └─ trade_plan (json)  │
│                        │
└────────────────────────┘
```

## Flow: Daily Cron

1. OpenAB cron fires at 21:00 台灣時間 (美股開盤前 30 分)
2. Sends prompt to kiro-cli: "執行每日自選股分析"
3. kiro-cli reads watchlist (from Supabase or local config)
4. For each stock:
   - `get_price(symbol)` → current price
   - `get_indicators(symbol, "1D")` → daily indicators
   - `get_levels(symbol)` → support/resistance
   - Opus 4.6 generates deep analysis
5. Results posted to Discord channel
6. Optionally: kiro-cli calls `/api/cron/save-analysis` to cache in Supabase

## Flow: User Views Dashboard

1. User opens stock-dashboard web
2. Frontend checks Supabase `analysis_cache` for today's pre-computed analysis
3. If cache hit → instant display (no loading)
4. If cache miss → user can trigger on-demand analysis (BYOK or kiro-cli polling)

## Flow: Other Users (BYOK)

1. User enters their own API key (Anthropic/OpenAI/Gemini) in settings
2. Clicks "分析" → direct API call → instant result
3. No cron, no kiro-cli dependency

## OpenAB Cron Config

```toml
# In OpenAB config.toml or cronjob.toml

[[cron.jobs]]
schedule = "0 13 * * 1-5"
channel = "YOUR_DISCORD_CHANNEL_ID"
message = """執行每日自選股分析。

請依照以下步驟：
1. 讀取自選股清單（見下方）
2. 對每支股票執行完整分析流程（get_price → get_indicators → get_levels → 深度分析）
3. 每支股票輸出：趨勢判斷、關鍵價位、操作建議、風險等級
4. 最後輸出摘要表格

自選股清單：
- NASDAQ:TSLA
- NASDAQ:NVDA
- NASDAQ:AAPL
- TWSE:2330
- TWSE:2454

如果有任何股票接近停損位或出現重大信號，請優先標記 🔴"""
platform = "discord"
sender_name = "DailyAnalysis"
timezone = "Asia/Taipei"
```

## Per-User Watchlist

### Option A: Hardcoded in cron message (simplest, for Joshua only)
- 直接把股票清單寫在 cron message 裡
- 要改就改 cronjob.toml（OpenAB 支援 hot-reload）

### Option B: Supabase watchlist table (multi-user)
- kiro-cli 先 call API 讀 watchlist，再逐一分析
- 需要額外的 `/api/watchlist` endpoint

### Recommendation
先用 Option A（簡單直接），之後有其他用戶再升級到 Option B。
改自選股只需要跟 Discord bot 說 "把 NASDAQ:AMD 加入自選股清單" → kiro-cli 改 cronjob.toml。

## Cost

| Item | Cost |
|------|------|
| kiro-cli (Opus 4.6) | $0 (subscription) |
| OpenAB | $0 (open source) |
| Supabase | $0 (free tier) |
| Zeabur container | existing plan |
| **Total** | **$0 extra** |

## Schedule Options

| Time (Taipei) | UTC | Use Case |
|---------------|-----|----------|
| 21:00 | 13:00 | 美股開盤前 30 分（夏令時） |
| 22:00 | 14:00 | 美股開盤前 30 分（冬令時） |
| 08:30 | 00:30 | 台股開盤前 30 分 |

可以設兩個 cron job：一個分析美股，一個分析台股。
