# /status Dashboard Page + ScoreChart Component

## Summary
Visual system monitoring page at `/status`. Shows system health, active metrics, cron schedules, and interactive scoring history chart.

## New Files
| File | Purpose |
|------|---------|
| src/app/status/page.tsx | System monitoring dashboard page |
| src/components/ScoreChart.tsx | SVG line chart for scoring history |

## Features
1. **Health Banner** — Green (healthy, <24h since run) or Yellow (stale)
2. **Stats Grid** — Open positions, watchlist size, weekly picks/scans
3. **Cron Schedule List** — All 6 schedules displayed
4. **Scoring History Chart** — SVG line chart with:
   - Consensus threshold line (65)
   - Green dots for consensus days, blue for non-consensus
   - Symbol selector (input + quick buttons: NVDA, TSLA, AAPL, SMCI)
   - Hover tooltips with date + score

## Data Sources
- `/api/dashboard/summary` — system stats
- `/api/cron/history?symbol=X&days=30` — chart data

## Build Status
✅ `next build` passes (0 errors, 6.7s)
- `/status` renders as static page (○)
- ScoreChart is client component (fetches on mount)

## Access
Navigate to: `https://<url>/status`
No auth required (read-only aggregate data).
