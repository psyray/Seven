---
name: seven-htb-api-sync
description: >-
  Work on Hack The Box API integration and SevenDatastore sync logic. Use when
  updating HTB endpoints, fixing fetch/sync bugs, adding machine/team/challenge
  data, rate limiting, partial bootstrap, force update, or v4/v5 API changes.
---

# Seven HTB API Sync

## Before editing

1. Read `config/htb.js`, `modules/htb-api.js`, `models/SevenDatastore.js`
2. Check `AGENTS.md` sync modes table
3. Confirm token model: `HTB_V4_TOKEN` only (no v3, no password refresh)

## Sync architecture

```
DAT.update(options)
  ├─ getSectionsNeedingUpdate()  → which phases to run
  ├─ [1/5] machines   → v5 list + selective v4 profiles
  ├─ [2/5] specials   → fortresses, endgames, prolabs
  ├─ [3/5] tags       → machine tags
  ├─ [4/5] team       → team stats + member profiles
  └─ [5/5] challenges → challenge list + details
```

## Decision tree

| User request | Implementation |
|--------------|----------------|
| Startup too slow | Ensure default `update()` skips cached sections |
| Force update members only | `update({ force: true })` — not `full: true` |
| Wipe and re-fetch all | `update({ full: true })` via admin clear cache |
| Missing machines for member sync | `getMemberSyncDependencies()` auto-expands |
| New HTB endpoint | Add to `htb-api.js`, wire in correct `update()` phase |
| Pusher fallback / live owns | `getRecentTeamActivity()` in `htb-api.js`; wired by `notification-router.js` |

## htb-api.js checklist

- [ ] Use `htbApiGet()` — never raw `fetch`/`request` without throttle
- [ ] Set `base: HTB_API_V5_BASE` only for v5 endpoints (machine list)
- [ ] Normalize responses before caching (`normalizeV5Machine`, etc.)
- [ ] Log rate-limit waits (`logRateLimitWait`) — user expects visible waits
- [ ] Bulk ops use `logBatchProgress()` + `mapWithConcurrency()`
- [ ] Handle paginated responses via `extractPaginatedItems()`

## Testing

```bash
npm run docker:logs          # watch [datastore] and [htb-api] modules
# Or locally:
LOG_LEVEL=debug HTB_API_LOG_REQUESTS=true node bot.js
```

Verify logs show skipped sections when cache is warm:
`Skipping machines fetch — using cached data`

## Common pitfalls

- **Token expired**: HTML response instead of JSON → check `HTB_V4_TOKEN`
- **Empty team embed**: `TEAM_STATS` or `TEAM_MEMBERS` empty → run force update
- **Rate limit silence**: ensure wait logs fire above `HTB_RATE_LIMIT_WAIT_THRESHOLD_MS`
- **Re-fetching everything on startup**: broken `hasCachedObject()` / missing `hydrateFromDbBackup()`

## References

- [reference.md](reference.md) — endpoint map and env vars
- [Gubarz unofficial HTB API](https://github.com/Gubarz/unofficial-htb-api) — v5 machines
- [D3vil0p3r HTB API](https://github.com/D3vil0p3r/HackTheBox-API) — v4 endpoints
