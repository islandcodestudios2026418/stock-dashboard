# Structural Shift Detector (Core SNDK-Finder)

## Summary
This is THE key endpoint — the signal that would have caught SNDK before its 3500% move. Detects when a mature stock massively outperforms its sector, indicating an industry structural shift.

## Endpoint
`GET /api/cron/structural-shift?secret=...`

## SNDK Pattern (What We're Looking For)
```
Mature company + Industry structural shift + Supply-demand imbalance + Catalyst
= 3500% in 1 year
```

SNDK 2013: NAND flash supply crunch + smartphone explosion. Company was "boring" for years, then industry dynamics fundamentally changed in its favor.

## Detection Logic (4 signals)
| Signal | Weight | Detection |
|--------|--------|-----------|
| Sector outperformance | 40 pts | Stock return > 2x sector ETF over 60d |
| Base breakout | 30 pts | Price breaks above 120-day consolidation range |
| Volume surge | 20 pts | Recent 5d avg > 1.5x 60d avg (institutional buying) |
| Sector tailwind | 10 pts | Sector itself is strong (>5% in 60d) |

## Scoring
- Shift Score 0-100
- **70+ = High priority** (sends 🏭 STRUCTURAL SHIFT Telegram alert)
- 30-69 = Partial signal (reported but no alert)
- <30 = Not reported

## What Makes This Different From Regular Scoring
The multi-agent scoring detects "is this a good stock to buy NOW?"
The structural shift detector asks "is something FUNDAMENTALLY changing in this stock's industry?"

The overlap is where magic happens: stock scores high on BOTH = SNDK-like explosive potential.

## Files
- `src/app/api/cron/structural-shift/route.ts` — detector endpoint

## Git
```
227dcda feat: structural shift detector - the core SNDK-finder signal
Branch: feature/weekly-ops-conviction-sectors (6 commits ahead)
```

## Build Status
✅ 54 pages compiled (0 errors)

## Usage
```bash
curl "https://<url>/api/cron/structural-shift?secret=<SECRET>"
# → {"signals":[{"symbol":"NVDA","shiftScore":85,"reasoning":"Outperforms sector 3.2x + Breaking 90d base + Volume surge"}],"highPriority":["NVDA"]}
```
