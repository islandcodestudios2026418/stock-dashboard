# Telegram Interactive Bot Commands

## Summary
Query the stock analysis system directly from Telegram chat. No need to open dashboard or curl endpoints.

## Endpoint
`POST /api/telegram/webhook` — receives Telegram Bot API updates

## Setup (one-time)
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<ZEABUR_URL>/api/telegram/webhook"
```

## Commands
| Command | Purpose |
|---------|---------|
| /status | System health: last run, positions, watchlist |
| /score NVDA | Latest analysis for a symbol (agents + RS) |
| /pending | Unacted consensus picks from past 7 days |
| /rs | Top 5 relative strength leaders vs SPY |
| /run | Trigger manual analysis scan |
| /brief | Resend morning briefing |
| /help | List available commands |

## Security
- Only responds to messages from `TELEGRAM_CHAT_ID` (silently ignores others)
- /run and /brief use CRON_SECRET internally
- No sensitive data exposed in responses

## Git
```
ea2a53b feat: Telegram interactive bot - query system via chat commands
Branch: feature/weekly-ops-conviction-sectors (5 commits ahead of master)
```

## Build Status
✅ 53 pages compiled (0 errors)
