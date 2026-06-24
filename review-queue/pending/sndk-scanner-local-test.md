# SNDK-Pattern Universe Scanner + Local Test Harness

## Summary
Auto-discovers explosive stock candidates from a 30-stock growth universe. Plus local test script for development.

## New Endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/cron/sndk-scanner | CRON_SECRET | Scans 30 growth stocks for SNDK-pattern |
| GET | /api/deploy-checklist | none | Shows env config status + next steps |

## SNDK Scanner
**Universe (30 stocks):**
- Semis: MU, MRVL, ON, LRCX, KLAC, AMAT, ASML, TXN
- AI/Cloud: PLTR, SNOW, CRWD, NET, DDOG, ZS, PANW
- Growth: SHOP, SQ, COIN, HOOD, RBLX, U
- Energy: FSLR, SEDG, RUN, PLUG
- Biotech: MRNA, REGN, VRTX
- Industrial: URI, PWR, EME

**Detection:**
- Base breakout: price > 120-day high (3% above)
- Volume surge: 5-day avg > 1.8x 60-day avg
- Both must be true = SNDK pattern confirmed
- Auto-adds confirmed candidates to watchlist
- Sends Telegram alert for new discoveries

**Cron:** Sunday 21:00 UTC (05:00 TW Monday)

## Local Test Script
```bash
npm run test:local
# Exercises 11 endpoints in sequence
# Requires: dev server running (npm run dev)
# Reports: pass/fail per endpoint with timing
```

## Cron Schedules (7 total)
| Time | Endpoint | Purpose |
|------|----------|---------|
| Mon-Fri 00:00 UTC | trigger | TW pre-market |
| Mon-Fri 12:30 UTC | trigger | US pre-market |
| Mon-Fri 13:30 UTC | trigger | Asia close |
| Mon-Fri 13:00-19:55 UTC | monitor | Position stops (5min) |
| Sunday 20:00 UTC | weekly-report | Performance summary |
| Sunday 20:30 UTC | watchlist-rotation | Remove stale |
| Sunday 21:00 UTC | sndk-scanner | Universe scan |

## Git
```
a06a685 chore: add SNDK scanner to weekly cron
7a5589b feat: SNDK-pattern universe scanner
1dc5021 feat: local test harness
Branch: feature/weekly-ops-conviction-sectors (13 commits ahead)
```

## Build Status
✅ 56 pages compiled (0 errors)
