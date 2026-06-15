---
name: seven-htb-api-sync
description: >-
  Work on Hack The Box API integration and SevenDatastore sync logic. Use when
  updating HTB endpoints, fixing fetch/sync bugs, adding machine/team/challenge
  data, rate limiting, partial bootstrap, force update, or v4/v5 API changes.
---

# Seven HTB API Sync

## Before editing

1. Read `config/htb.js`, `modules/htb-api.js`, `helpers/htb-sync-engine.js`, `models/SevenDatastore.js`
2. Check `AGENTS.md` sync modes table
3. Confirm token model: `HTB_V4_TOKEN` + `HTB_REFRESH_TOKEN` (OAuth — no v3, no App Token without refresh)
4. Persistence: `HTB_TOKEN_FILE` (priority load) + `HTB_ENV_FILE` (`.env` sync via `helpers/env-tokens.js`)

## Sync architecture

All sync logic lives in **`helpers/htb-sync-engine.js`** (`HtbSyncEngine`). `SevenDatastore.update()` delegates to `syncEngine.runPlan()`.

```
DAT.update(options) → HtbSyncEngine.runPlan()
  ├─ diffCatalog(kind)     → API list vs cache IDs (+ stale metadata)
  ├─ fetchAndMerge(kind)   → detail fetch for missing/stale IDs only
  ├─ ensureTarget(type)    → on-demand (Pusher, resolveEntWithEnsure)
  └─ sections: machines → fortresses → endgames → prolabs → tags → team → challenges
```

| Option | Behaviour |
|--------|-----------|
| `{}` / boot | Partial bootstrap — missing sections only |
| `{ delta: true }` | Hourly: all sections, delta + stale, new team members only |
| `{ force: true }` | Delta catalogs + stale + **full** team member refresh |
| `{ full: true, bootstrap: true }` | Clear cache admin — delta from empty |
| `{ sections: ["fortresses"] }` | `seven sync fortresses` |
| `{ targets: [{ type, name }] }` | Explicit ensure |

Specials stored in `MISC.FORTRESSES`, `MISC.ENDGAMES`, `MISC.PROLABS`. Empty `{}` is **not** cached (`hasCachedObject`).

## Decision tree

| User request | Implementation |
|--------------|----------------|
| Pusher skip target not in cache | `ensureCachedTarget()` in `notification-router.js` before skip |
| Startup too slow | Default boot uses `getMissingSections()` only |
| Force update | `update({ force: true })` — delta catalogs + full team |
| Wipe and re-fetch all | `update({ full: true, bootstrap: true })` via admin clear cache |
| Sync one section | `update({ sections: ["machines"] })` or `seven sync machines` |
| New HTB endpoint | Add to `htb-api.js`, wire in `HtbSyncEngine.fetchAndMerge` / `fetchCatalog` |
| On-demand single target | `ensureTarget()` — never full section sync |

## htb-api.js checklist

- [ ] Use `htbApiGet()` — never raw `fetch`/`request` without throttle
- [ ] Bulk specials use `getCompleteFortressesByIds` / `getCompleteEndgamesByIds` / `getCompleteProlabsByIds`
- [ ] On-demand machine: `buildMachineFromProfileIdentifier(name)`
- [ ] Set `base: HTB_API_V5_BASE` only for v5 endpoints (machine list)
- [ ] Bulk ops use `logBatchProgress()` + `mapWithConcurrency()`

## Testing

```bash
npm run test:sync
npm run docker:logs          # watch [htb-sync], [datastore], [htb-api]
LOG_LEVEL=debug HTB_API_LOG_REQUESTS=true node bot.js
```

Look for: `Catalog delta fetching`, `ensureTarget merged`, `Catalog delta up to date`.

## Help text

In-bot manual: `static/strings.js` → `buildHelpMessages()` (sections `sectionCaptain`, `sectionAdmin` for sync commands).

User mirror: `docs/user/commands.md`.

## Common pitfalls

- **Empty specials in DB `{}`**: fixed — `hasCachedObject` treats as missing
- **Token expired**: HTML response instead of JSON → refresh or re-login
- **Force update ≠ full**: force still uses delta for catalogs; only team is fully refreshed
- **UPDATE_LOCK**: `runPlan` holds lock; `ensureTarget` uses per-target lock and can run concurrently
- **Pro lab list order**: HTB catalog includes high-id mini labs; `filterEnt` defaults fortress/endgame/prolab to id **asc**; `list prolabs` uses `nolimit` in `nlp.js`

## References

- [reference.md](reference.md) — endpoint map and env vars
- [Gubarz unofficial HTB API](https://github.com/Gubarz/unofficial-htb-api) — v5 machines
- [D3vil0p3r HTB API](https://github.com/D3vil0p3r/HackTheBox-API) — v4 endpoints
