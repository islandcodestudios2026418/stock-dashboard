# Phase 3: IBKR Integration Groundwork

## Summary
Added Interactive Brokers Web API client library and order execution endpoint.
This is the foundation for automated trade execution when consensus picks fire.

## Files Added
- `src/lib/ibkr-client.ts` — IBKR REST client (accounts, positions, orders, position sizing)
- `src/app/api/ibkr/route.ts` — API endpoint (GET status/positions/orders, POST place/cancel/execute_pick)

## Key Design Decisions
1. **Paper trading by default** — Unless `IBKR_LIVE=true` is set, all orders return SIMULATED status
2. **Risk management built-in** — `calculatePositionSize()` uses $30K capital / 3 max positions / 40% risk budget
3. **Consensus pick execution** — `action: "execute_pick"` calculates sizing from stop-loss and places LMT entry
4. **IBKR Client Portal Gateway** — Uses REST API at localhost:5000 (standard IBKR gateway deployment)

## API Endpoints Added
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/ibkr?action=status | CRON_SECRET | Check config status |
| GET | /api/ibkr?action=positions | CRON_SECRET | List positions |
| GET | /api/ibkr?action=orders | CRON_SECRET | List open orders |
| GET | /api/ibkr?action=summary | CRON_SECRET | Account summary (NLV, buying power) |
| POST | /api/ibkr {action:"execute_pick"} | CRON_SECRET | Auto-execute consensus pick with risk sizing |
| POST | /api/ibkr {action:"place"} | CRON_SECRET | Manual order placement |
| POST | /api/ibkr {action:"cancel"} | CRON_SECRET | Cancel order by ID |

## Env Vars Required
```
IBKR_GATEWAY_URL=https://localhost:5000/v1/api  (default)
IBKR_ACCOUNT_ID=U1234567
IBKR_LIVE=false  (set to "true" for real orders)
```

## Usage Example
```bash
# Check status (paper mode)
curl "http://localhost:3000/api/ibkr?action=status" \
  -H "Authorization: Bearer YOUR_SECRET"

# Execute consensus pick (paper mode — no real orders)
curl -X POST "http://localhost:3000/api/ibkr" \
  -H "Authorization: Bearer YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"execute_pick","symbol":"NVDA","currentPrice":135.50,"stopLossPrice":95.00}'
```

## Build Status
✅ `next build` passes (0 errors, TypeScript + Turbopack)

## Next Steps
- Deploy IBKR Client Portal Gateway (Docker or local)
- Set IBKR_ACCOUNT_ID env var (paper trading account)
- Wire escalateAlert() → auto execute_pick when consensus fires
- Add stop-loss order placement after entry fill
