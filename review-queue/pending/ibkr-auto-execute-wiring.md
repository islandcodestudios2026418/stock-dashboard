# Phase 3 Part 2: IBKR Auto-Execution Wiring

## Summary
Wired IBKR auto-execution directly into the consensus alert flow. When a consensus pick fires
AND `IBKR_AUTO_EXECUTE=true`, the system automatically calculates position size and places
a bracket order (entry + stop-loss + take-profit).

## Changes

### src/lib/ibkr-client.ts
- Added `placeBracketOrder()` — places entry LMT + stop-loss STP + optional take-profit LMT in sequence
- All three orders use GTC (Good Till Cancel) time-in-force

### src/app/api/cron/run-analysis/route.ts
- Import `placeBracketOrder` and `calculatePositionSize` from ibkr-client
- Import `TradePlan` type from levels
- Results now carry `tradePlan` field alongside scoring data
- `escalateAlert()` enhanced: after Telegram/Discord notifications, if `IBKR_AUTO_EXECUTE=true`:
  - Loops consensus picks
  - Calculates position size from trade plan's entry/stopLoss
  - Places bracket order via IBKR client
  - Sends Telegram confirmation with order details and status
  - Non-blocking: IBKR failure doesn't break notifications

## Safety Design
```
IBKR_LIVE=false (default) → all orders return SIMULATED status
IBKR_AUTO_EXECUTE=false (default) → escalateAlert skips execution entirely
Both must be true + IBKR_ACCOUNT_ID set → real orders placed
```

## Build Status
✅ `next build` passes (TypeScript + Turbopack, 0 errors)

## Testing Steps
1. Run `POST /api/cron/run-analysis` on a watchlist with a known consensus stock
2. Verify: Telegram receives both URGENT alert AND auto-execute confirmation
3. In paper mode: order shows status=SIMULATED
4. In live mode: verify IBKR Gateway receives order via its logs
