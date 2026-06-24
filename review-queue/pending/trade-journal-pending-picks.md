# Trade Journal + Pending Picks (Phase 1 Semi-Auto)

## Summary
Decision journal for Phase 1 semi-auto mode. Log why you accepted/rejected/deferred consensus picks. Track pending picks awaiting action.

## New Endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/journal | none | List decisions (?symbol=, ?status=, ?days=) |
| POST | /api/journal | CRON_SECRET | Log decision (symbol, decision, reason, scores) |
| GET | /api/cron/pending-picks | none | Consensus picks not yet decided on |

## New Files
| File | Purpose |
|------|---------|
| src/app/api/journal/route.ts | Decision journal CRUD |
| src/app/api/cron/pending-picks/route.ts | Pending picks finder |

## Schema Addition (section 8)
```sql
trade_decisions (symbol, date, decision, reason, avg_score, conviction_score, trade_plan jsonb)
```

## Workflow
1. Cron fires → finds consensus pick → sends 🚨 URGENT alert
2. Joshua checks `/api/cron/pending-picks` → sees unacted picks
3. Joshua decides: POST to `/api/journal` with decision + reason
4. Decision history available for review + future backtesting of decision quality

## Usage
```bash
# See pending picks needing action
curl "https://<url>/api/cron/pending-picks"

# Accept a pick
curl -X POST "https://<url>/api/journal" \
  -H "Authorization: Bearer <SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"NVDA","decision":"accepted","reason":"Strong ADX + sector tailwind","avg_score":82}'

# Reject a pick
curl -X POST "https://<url>/api/journal" \
  -H "Authorization: Bearer <SECRET>" \
  -d '{"symbol":"AMD","decision":"rejected","reason":"Already at resistance, wait for pullback"}'

# View history
curl "https://<url>/api/journal?days=7"
```

## Build Status
✅ `next build` passes (0 errors, 6.8s, 49 pages)
