# Relative Strength + Earnings Calendar

## Summary
Two key market intelligence endpoints: IBD-style relative strength ranking and earnings date tracking.

## New Endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/cron/relative-strength?secret=... | CRON_SECRET | RS rating vs SPY (1-99 percentile) |
| GET | /api/cron/earnings-calendar?secret=... | CRON_SECRET | Upcoming earnings flags (14-day lookahead) |

## Relative Strength
- Fetches 60-day performance for SPY + all watchlist symbols
- Computes relative performance (stock return - SPY return)
- Ranks symbols into 1-99 percentile (IBD RS Rating style)
- Returns: leaders (RS≥80), laggards (RS≤20), full ranking

## Earnings Calendar
- Uses yahoo-finance2 quoteSummary calendarEvents module
- Gets next earnings date for each watchlist symbol
- Flags those with earnings in next 14 days
- Returns sorted by proximity (soonest first)

## Pipeline Integration
- run-analysis now fetches SPY benchmark once before loop
- Each symbol gets `rsVsSpy` in scoring JSON (stock's 60d return minus SPY's)
- Positive = outperforming S&P 500, negative = lagging

## Git
```
54eaf21 feat: relative strength vs SPY + earnings calendar endpoint
Branch: feature/weekly-ops-conviction-sectors (pushed)
```

## Build Status
✅ 51 pages compiled (0 errors, 4.0s)

## Usage
```bash
# Relative strength ranking
curl "https://<url>/api/cron/relative-strength?secret=<SECRET>"
# → {"benchmark":{"symbol":"SPY","performance":3.2},"leaders":["NVDA","SMCI"],"laggards":["AAPL"]}

# Earnings calendar
curl "https://<url>/api/cron/earnings-calendar?secret=<SECRET>"
# → {"upcoming":[{"symbol":"NVDA","earningsDate":"2026-07-02","daysUntil":8,"isUpcoming":true}]}
```
