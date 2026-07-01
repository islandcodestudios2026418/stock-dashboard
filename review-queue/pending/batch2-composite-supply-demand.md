# Batch 2: Composite Enhancement + Supply-Demand + Pipeline Cron

## Date: 2026-07-01
## Agent: stock-cron

## What was built

### Enhanced signal-composite (REWRITTEN)
Now integrates ALL signals into one ranking:
- **Old**: base(50%) + MTF(20) + RS(15) + conviction(15) + vol(±10)
- **New**: base(40%) + MTF(15) + RS(10) + conviction(10) + vol(10) + **options(10)** + **institutional(10)**

Options flow scoring:
- SMART_MONEY_CALL: +10 pts
- BULLISH_FLOW: +8 pts
- UNUSUAL_ACTIVITY (>60%): +5 pts
- BEARISH_FLOW: -8 pts
- PROTECTIVE_PUTS: -6 pts

Institutional scoring:
- SPRING: +12 pts (highest — the Wyckoff trap is the #1 entry signal)
- BREAKOUT_ON_VOLUME: +10 pts
- SHAKEOUT_REVERSAL / NARROW_RANGE: +8 pts
- VOLUME_DRYUP: +7 pts
- ACCUMULATION phase: +4 pts
- DISTRIBUTION: -8 pts (also blocks actionability)
- MARKDOWN: -10 pts

New flags: 📞 Bullish flow, 📉 Bearish flow, 🏦 Institutional, 🚨 Distribution

### /api/cron/supply-demand — THE SNDK core pattern (340 lines)
Scores 0-100 across 4 equally-weighted components:

1. **Supply Constraint (0-25)**: volume declining while price holds, ATR compression, base building with rising lows
2. **Demand Surge (0-25)**: up/down volume ratio >2x, price acceleration, breakout from base on volume
3. **Consolidation (0-25)**: stock outperforming sector ETF, making highs while sector lags, decoupling
4. **Pricing Power (0-25)**: EMA spread widening, effortless advance (up on declining vol), strong candles

Phases detected:
- EARLY_ACCUMULATION → supply + consolidation building
- SUPPLY_TIGHTENING → strong supply score, demand not yet
- DEMAND_INFLECTION → demand surging, supply still catching up
- MARKUP_BEGINS → both supply AND demand signals = the explosive move

Uses sector ETF benchmarks: SMH (semis), XLK (tech), XLE (energy), XLV (healthcare), XLF (financials), CARZ (EV), XLI (industrials)

### Cron Schedule Update
- Replaced 20:30 TW `/api/cron/trigger` with `/api/cron/pipeline` (comprehensive daily digest)
- Added Sunday 06:00 TW: `/api/cron/supply-demand` scan
- Total: 8 cron schedules

## Build: ✅ clean (71 routes, 0 errors, 9.3s compile, 619ms static)

## Files Modified
- src/app/api/cron/signal-composite/route.ts (REWRITTEN — now calls options-flow + institutional-tracker)
- src/app/api/cron/supply-demand/route.ts (NEW, 340 lines)
- zeabur.json (updated cron targets)

## Architecture Impact
The signal chain is now:
```
run-analysis (5-agent base scores)
  → signal-composite (adds MTF + RS + conviction + vol + OPTIONS + INSTITUTIONAL)
    → pipeline (orchestrates everything + supply-demand + entry/exit + position health)
      → Telegram daily digest
```

Pipeline is the new top-level daily intelligence. One cron call → complete picture.
