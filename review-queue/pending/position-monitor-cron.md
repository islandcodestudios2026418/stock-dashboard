# Position Monitor Cron + IBKR Env Vars

## Summary
Added real-time position monitor that enforces stop-loss rules automatically.
Runs every 5 minutes during US market hours via Zeabur cron.

## Files Added
- `src/app/api/cron/monitor/route.ts` — Position monitoring endpoint

## Files Modified
- `zeabur.json` — Added 4 IBKR env vars + position monitor cron schedule

## How It Works
1. Reads open positions from `portfolio_positions` table (Supabase)
2. Fetches current price for each via yahoo-finance2
3. Checks two stop rules:
   - **40% absolute stop**: exit if price drops 40% from entry
   - **25% trailing stop**: if position gained 10%+, exit if drops 25% from peak
4. If triggered:
   - Places MKT SELL via IBKR (if IBKR_AUTO_EXECUTE=true)
   - Updates position status to "stopped" in Supabase
   - Sends Telegram notification with P&L
5. Tracks peak_price in DB for trailing stop calculation

## Cron Schedule
```
*/5 13-19 * * 1-5  →  Every 5 min, Mon-Fri, 13:00-19:55 UTC
                      (US market hours: 9:30-16:00 ET ≈ 13:30-20:00 UTC)
```

## New Env Vars in zeabur.json
```
IBKR_GATEWAY_URL    - Client Portal Gateway URL
IBKR_ACCOUNT_ID     - IBKR account number
IBKR_LIVE           - "true" for real orders
IBKR_AUTO_EXECUTE   - "true" to enable auto-execution
```

## Build Status
✅ `next build` passes (0 errors)

## Endpoint
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/cron/monitor?secret=... | CRON_SECRET | Check positions, enforce stops |

## Response
```json
{ "checked": 3, "exits": [{"symbol":"NVDA","reason":"Trailing stop (-25% from peak $180.00)","exitPrice":135.00,"pnlPct":12.5}] }
```
