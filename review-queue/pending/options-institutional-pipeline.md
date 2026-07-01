# Options Flow + Institutional Tracker + Pipeline

## Date: 2026-07-01
## Agent: stock-cron

## What was built

### /api/cron/options-flow — Detect smart money positioning via options
Fetches Yahoo Finance options chains for watchlist stocks, analyzes:
- **Put/Call ratio** — extreme values signal directional bias
- **Volume vs Open Interest** — vol >5x OI = new large positions opening
- **IV Skew** — put IV > call IV = market pricing downside risk
- **Max Pain Strike** — where most options expire worthless (gravitational price)

Signals (strength 0-100):
1. **SMART_MONEY_CALL** — multiple unusual call strikes above price + low P/C
2. **BULLISH_FLOW** — very low P/C ratio + high call volume
3. **BEARISH_FLOW** — elevated P/C + put IV skew
4. **PROTECTIVE_PUTS** — high put volume (hedging)
5. **UNUSUAL_ACTIVITY** — 3+ strikes with vol/OI > 5x

### /api/cron/institutional-tracker — Wyckoff accumulation detection
Identifies market cycle phases using volume-price behavior:
- **Phase detection**: ACCUMULATION / MARKUP / DISTRIBUTION / MARKDOWN
- **OBV trend**: On-Balance Volume rising/falling
- **Up/Down volume ratio**: vol on green days vs red days (>1.5 = buying)
- **Narrow range counting**: tight bars on low vol = supply absorption

Signals:
1. **SPRING** — dip below support then immediate reclaim (Wyckoff trap)
2. **VOLUME_DRYUP** — vol at <60% of avg during consolidation (breakout imminent)
3. **NARROW_RANGE_ABSORPTION** — 6+ tight days + rising OBV (quiet buying)
4. **SHAKEOUT_REVERSAL** — big red candle on 2x vol, fully recovered next day
5. **BREAKOUT_ON_VOLUME** — 20d high break on 1.5x avg volume

### /api/cron/pipeline — Unified daily intelligence digest
Single endpoint that orchestrates ALL signal endpoints:
- Calls 9 endpoints in parallel (2 groups: market-level → stock-level)
- Produces structured DailyDigest JSON with:
  - Market conditions (vol regime, breadth, dynamic consensus threshold)
  - Top picks with composite scores + entry patterns + price zones
  - Options flow highlights
  - Institutional accumulation signals
  - Structural shift detections
  - Exit alerts for open positions
  - Position health summary
  - **Prioritized action items** (most important first)
- Sends formatted text summary to Telegram
- Stores digest in Supabase analysis_runs

### New Telegram Commands (+4, total: 27)
- `/options [SYM]` or `/flow [SYM]` — options flow analysis
- `/inst [SYM]` — institutional accumulation patterns
- `/pipeline` or `/digest` — run full daily pipeline

## Build: ✅ clean (Next.js 16.2.6, 70 routes, 0 errors)

## Files
- src/app/api/cron/options-flow/route.ts (NEW, 260 lines)
- src/app/api/cron/institutional-tracker/route.ts (NEW, 246 lines)
- src/app/api/cron/pipeline/route.ts (NEW, 288 lines)
- src/app/api/telegram/webhook/route.ts (MODIFIED, +4 commands)

## Architecture Note
The pipeline endpoint is designed to replace the morning-brief as the primary cron target:
- morning-brief: narrative format, good for quick glance
- pipeline: structured JSON + text, good for decision-making + programmatic consumption
- Recommended: wire `pipeline` to the 20:30 TW cron, keep morning-brief as 08:00 TW

## Why this matters for SNDK-finding
Options flow is the #1 leading indicator — institutions buy calls/puts BEFORE the move.
Institutional accumulation (Wyckoff) tells you WHEN smart money is building positions.
The pipeline combines both with all existing signals into one actionable digest.
