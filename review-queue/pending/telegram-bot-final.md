# Telegram Bot Complete (12 Commands)

## Commands
| Command | Purpose | Auth |
|---------|---------|------|
| /help | List all commands | — |
| /status | System health (last run, positions, watchlist) | — |
| /score NVDA | Latest analysis + agent breakdown + RS | — |
| /pending | Unacted consensus picks (past 7d) | — |
| /accept NVDA reason | Log accepted decision | writes to DB |
| /reject NVDA reason | Log rejected decision | writes to DB |
| /add NVDA | Add symbol to watchlist | writes to DB |
| /remove NVDA | Remove from watchlist | writes to DB |
| /rs | Top 5 relative strength leaders | calls API |
| /shift | Run structural shift detector | calls API |
| /run | Trigger full analysis scan | calls API |
| /brief | Resend morning briefing | calls API |

## Phase 1 Workflow (All From Telegram)
```
1. 🚨 Alert arrives: "CONSENSUS PICK: NVDA — 82/100"
2. /score NVDA → see full agent breakdown
3. /shift → check structural shift signals
4. /accept NVDA strong ADX + sector in leadership
   → Decision logged to trade_decisions table
   → If IBKR_AUTO_EXECUTE=true: order placed automatically
```

## Watchlist Management (From Phone)
```
/add SMCI      → adds NASDAQ:SMCI to watchlist
/remove TSLA   → deactivates from daily scan
```

## Security
- Only responds to TELEGRAM_CHAT_ID
- Read commands work for authorized chat only
- Write commands go through Supabase service role
- API calls use CRON_SECRET internally

## Git
Branch: feature/weekly-ops-conviction-sectors
Latest: b4db94a (10 commits ahead of master)

## Build
✅ 55 pages compiled (0 errors)
