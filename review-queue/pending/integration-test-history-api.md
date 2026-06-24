# Integration Test + History API

## Summary
Two new read-only endpoints for operational monitoring and dashboard charting.

## New Endpoints

### GET /api/cron/integration-test?secret=...
Full pipeline validation, no side effects. Tests 5 stages in sequence:
1. Yahoo Finance fetch (AAPL, 60d)
2. Indicators calculation (RSI, MACD, risk)
3. Multi-agent scoring (5-agent deterministic)
4. Orchestrator with mock LLM (1 round, immediate consensus)
5. Supabase connectivity (read-only)

Returns `{ allPass, totalMs, results: [{stage, pass, ms, detail}] }`.
HTTP 200 if all pass, 503 if any fail.

### GET /api/cron/history?symbol=NVDA&days=30
Chart-ready scoring time series. No auth required.
- Reads from `analysis_results` table
- Returns: `{ symbol, days, count, history: [{date, avgScore, consensus, agents[{name,score}]}] }`
- Max 365 days
- Use for sparkline chart in dashboard or external monitoring

## Build Status
✅ `next build` passes (0 errors, 5.9s compile)

## Usage
```bash
# Integration test (deployed)
curl "https://<url>/api/cron/integration-test?secret=<SECRET>"
# → {"allPass":true,"totalMs":2340,"results":[...]}

# Scoring history
curl "https://<url>/api/cron/history?symbol=NVDA&days=30"
# → {"symbol":"NVDA","days":30,"count":22,"history":[...]}
```
