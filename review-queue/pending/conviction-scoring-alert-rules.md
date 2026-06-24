# Conviction Scoring + Custom Alert Rules

## Summary
Added conviction scoring overlay (tracks score trend) and per-symbol alert rules CRUD.

## New Files
| File | Purpose |
|------|---------|
| src/lib/conviction.ts | Conviction scoring: streak, momentum, urgency detection |
| src/app/api/alerts/route.ts | Alert rules CRUD endpoint |

## Modified Files
| File | Change |
|------|--------|
| src/app/api/cron/run-analysis/route.ts | Imports conviction, computes per-symbol, stores in scoring JSON, shows 🔥streak in text |
| supabase-schema.sql | Added alert_rules table (section 7) |

## Conviction Scoring
- Reads 14 days of history from Supabase `analysis_results`
- Computes: rising streak, momentum (avg daily change), urgency flag
- Formula: base 50 + streak×5 (max 25) + momentum×5 (max 25)
- Urgent flag: first consensus after 5+ days of rising = `🔥` in text summary
- Stored in `scoring.conviction` JSON field in analysis_results

## Alert Rules API
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/alerts | none | List active rules (?symbol= optional filter) |
| POST | /api/alerts | CRON_SECRET | Upsert rule (symbol, min_score, notify_on_rise, cooldown_hours) |
| DELETE | /api/alerts | CRON_SECRET | Deactivate a rule |

## Schema Addition
```sql
alert_rules (symbol UNIQUE, min_score int, notify_on_rise bool, cooldown_hours int, active bool, updated_at)
```

## Build Status
✅ `next build` passes (0 errors, 6.5s)

## Usage
```bash
# Create rule: alert when NVDA scores ≥ 70 (custom threshold)
curl -X POST "https://<url>/api/alerts" \
  -H "Authorization: Bearer <SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"NVDA","min_score":70,"cooldown_hours":48}'

# List all rules
curl "https://<url>/api/alerts"
```
