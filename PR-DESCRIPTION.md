# PR: Operational Intelligence Layer + Telegram Bot + SNDK Scanner

## Summary
Adds complete operational monitoring, SNDK-pattern detection, and mobile-first Telegram interface to the daily stock analysis cron system.

## Key Additions (16 commits, 56 pages)

### 🏭 SNDK-Finder Intelligence
- **Structural shift detector**: Detects stocks outperforming sector 2x+, breaking out of long bases
- **SNDK universe scanner**: Scans 30 growth stocks weekly, auto-adds candidates to watchlist
- **Relative strength**: IBD-style RS rating (1-99) vs SPY over 60 days
- **Earnings calendar**: 14-day lookahead catalyst detection
- **Sector rotation**: 11 sector ETFs momentum ranking + rotation signals
- **Conviction scoring**: Streak tracking + momentum + urgency detection

### 📱 Telegram Bot (14 commands)
Full system control from phone: `/score`, `/pending`, `/accept`, `/reject`, `/add`, `/remove`, `/watchlist`, `/rs`, `/shift`, `/scan`, `/run`, `/brief`, `/status`, `/help`

### 📊 Operational Monitoring
- Weekly performance report (automated, Sunday)
- Watchlist rotation (removes stale symbols, Sunday)
- Morning briefing (unified intelligence, auto after each scan)
- Dashboard summary API
- Integration test endpoint (5-stage pipeline validation)
- Deploy checklist (env var status)
- Scoring history API (chart-ready)
- `/status` page with ScoreChart SVG

### 📝 Phase 1 Decision Support
- Trade journal (accept/reject/defer decisions)
- Pending picks tracker
- Custom alert rules per symbol

## Cron Schedules (7 total)
- Mon-Fri: 3x daily analysis + morning brief + structural shift
- Mon-Fri: Position monitor (every 5min during US hours)
- Sunday: Weekly report + watchlist rotation + SNDK scanner

## Breaking Changes
None. All additive — existing endpoints unchanged.

## Testing
- `next build`: ✅ 56 pages, 0 errors
- `npm run test:local`: 11-endpoint local validation script
- `/api/cron/integration-test`: Pipeline validation endpoint

## Merge Notes
- Merge to master → Zeabur auto-deploys
- Run Supabase migration: add `alert_rules` + `trade_decisions` tables (see supabase-schema.sql sections 7-8)
- Set Telegram webhook: `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL>/api/telegram/webhook"`
- Verify: `GET /api/deploy-checklist`
