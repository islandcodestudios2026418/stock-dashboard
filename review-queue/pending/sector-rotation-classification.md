# Sector Rotation Detector + Classification

## Summary
Added sector rotation analysis endpoint and integrated sector context into the scoring pipeline.

## New Files
| File | Purpose |
|------|---------|
| src/app/api/cron/sector-rotation/route.ts | Sector momentum ranking + rotation detection |
| src/lib/sector-classification.ts | Stock→sector mapping + getSectorForStock helper |

## Modified Files
| File | Change |
|------|--------|
| src/app/api/cron/run-analysis/route.ts | Imports sector-classification, stores sector context in scoring JSON |

## Sector Rotation Endpoint
`GET /api/cron/sector-rotation?secret=...`

- Fetches 11 SPDR sector ETFs (XLK, XLE, XLF, etc.) from Yahoo Finance
- Computes 20-day + 5-day momentum per sector
- Ranks by 20d momentum (strongest at top)
- Detects rotation signals: sectors accelerating from low rank position
- Returns: `{ sectors[], topSectors, rotationSignals, summary }`

## Sector Classification
- Maps 25+ common stocks to their sector ETF
- Integrated into run-analysis: each symbol's sector stored in `scoring.sector`
- Enables future feature: bonus score when stock's sector is in top 3

## Build Status
✅ `next build` passes (0 errors, 5.3s)

## Usage
```bash
# Check sector rotation
curl "https://<url>/api/cron/sector-rotation?secret=<SECRET>"
# → {"topSectors":["Technology","Communication Services","Consumer Discretionary"], "rotationSignals":["Energy (XLE) rising from #8"]}
```
