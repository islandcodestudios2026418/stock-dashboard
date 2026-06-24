# Weekly Report + Watchlist Rotation + Dashboard Summary

## Summary
Added 3 new endpoints to complete the operational monitoring layer for the daily cron system.

## New Endpoints

### 1. GET /api/cron/weekly-report?secret=...
- Aggregates past 7 days: analysis results + portfolio P&L
- Computes: consensus picks, top scorers, win rate, total P&L, stale symbols
- Sends formatted report via Telegram (HTML) + Discord (embed)
- Scheduled: Sunday 20:00 UTC (04:00 TW Monday)

### 2. GET /api/cron/watchlist-rotation?secret=...
- Checks all active watchlist symbols against 28-day avg score
- Removes (deactivates) symbols scoring below 40 with 5+ data points
- Supports `?dry=1` mode for preview
- Sends Telegram notification listing removed symbols
- Scheduled: Sunday 20:30 UTC (04:30 TW Monday)

### 3. GET /api/dashboard/summary (no auth)
- System health at a glance: last run age, open positions, watchlist size
- Weekly consensus picks count + scan count
- All 6 cron schedule descriptions
- Status: "healthy" (last run < 24h) or "stale"

## Modified Files
| File | Change |
|------|--------|
| src/app/api/cron/weekly-report/route.ts | NEW — weekly performance report |
| src/app/api/cron/watchlist-rotation/route.ts | NEW — auto-remove stale symbols |
| src/app/api/dashboard/summary/route.ts | NEW — system health endpoint |
| zeabur.json | Added 2 weekly cron schedules (6 total) |

## Cron Schedules (Complete — 6 total)
| Schedule | Path | Purpose |
|----------|------|---------|
| 30 12 * * 1-5 | /api/cron/trigger | US pre-market (20:30 TW) |
| 0 0 * * 1-5 | /api/cron/trigger | TW pre-market (08:00 TW) |
| 30 13 * * 1-5 | /api/cron/trigger | Asia close (21:30 TW) |
| */5 13-19 * * 1-5 | /api/cron/monitor | Position stop-loss (every 5min) |
| 0 20 * * 0 | /api/cron/weekly-report | Weekly report (Sunday) |
| 30 20 * * 0 | /api/cron/watchlist-rotation | Watchlist cleanup (Sunday) |

## Build Status
✅ `next build` passes (0 errors)

## Usage
```bash
# Weekly report (manual trigger)
curl "https://<url>/api/cron/weekly-report?secret=<SECRET>"

# Watchlist rotation dry-run
curl "https://<url>/api/cron/watchlist-rotation?secret=<SECRET>&dry=1"

# Dashboard health check
curl "https://<url>/api/dashboard/summary"
```
