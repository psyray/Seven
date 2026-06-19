# Seven — Agent Guide

Discord bot for Hack The Box teams. Node.js + DialogFlow + PostgreSQL.

## Documentation

| Audience | Start here |
|----------|------------|
| Discord users | [docs/user/README.md](docs/user/README.md) |
| Server admins | [docs/admin/setup.md](docs/admin/setup.md) |
| Contributors | [CONTRIBUTING.md](CONTRIBUTING.md) |
| API reference | [docs/api/index.html](docs/api/index.html) |

Full index: [docs/README.md](docs/README.md)

## Architecture

```
bot.js              Entry point, Discord client, intent routing, DB backup
models/
  SevenDatastore.js In-memory HTB cache, sync orchestration, entity resolution
  api-classes.js    JSDoc typedefs for HTB entities
modules/
  htb-api.js        HTB API v4/v5 connector (token auth, throttling, pagination)
  send.js           Discord message delivery (human-like typing, embeds)
  seven-api-server.js  Optional Express API (API_SERVER_ENABLED)
  charts/           Highcharts image generation
views/
  embeds.js         HtbEmbeds — Discord embed builders
helpers/
  format.js         String/date/URL formatting (Format class)
  helpers.js        General utilities (Helpers class)
  logger.js         Winston logger (createLogger)
  classes.js        Domain wrappers (HtbMachine, TeamMember, …)
  dflow.js          DialogFlow entity sync
  pusher-htb.js     HTB Pusher client + HTML event parser
  notification-router.js  Real-time own routing, mentions, fallback poll, captain repost
  notification-store.js   Postgres persistence for notification events
  pusher-config.js  PUSHER_* env toggles
  env-tokens.js       Atomic HTB OAuth sync to HTB_ENV_FILE (.env)
config/
  htb.js            HTB_API_BASE, HTB_API_V5_BASE, HTB_APP_BASE
static/
  strings.js        User-facing copy
  templates/.env.docker.example  Single env template (copy to .env)
```

## Data flow

1. **Startup**: `importDbBackup()` restores JSON columns from Postgres → `DAT.hydrateFromDbBackup()`
2. **Sync**: `DAT.update()` fetches missing sections from HTB API (smart partial sync)
3. **Query**: User message → DialogFlow intent OR `resolveEnt()` → `HtbEmbeds` → `Send.embed()`
4. **Persist**: `updateCache()` writes in-memory state back to Postgres
5. **Real-time owns**: HTB Pusher → `NotificationRouter` → announce channel + debounced cache update; each event persisted via `NotificationStore` → `seven_notification_events`

## HTB API (v4 OAuth auth)

- Auth: `HTB_V4_TOKEN` (OAuth access JWT) + `HTB_REFRESH_TOKEN` (refresh) — **no v3 session, no password login, no static App Token**
- Refresh: `POST labs.hackthebox.com/api/v4/login/refresh` — automatic before access expiry; HTB rotates refresh token each time
- Persistence: `HTB_TOKEN_FILE` JSON (loaded first) + optional `HTB_ENV_FILE` (`.env` sync via `helpers/env-tokens.js`)
- Hot-reload: `seven htb token set <refresh>` or `seven htb token set <access> <refresh>`; watch `HTB_TOKEN_FILE`
- Auth failure: captains notified by Discord DM; bot continues with cached data
- v4 base: `https://labs.hackthebox.com/api/v4` (profiles, team, challenges, …)
- v5 base: `https://labs.hackthebox.com/api/v5` (machine list pagination)

## Sync modes (`SevenDatastore.update` → `HtbSyncEngine.runPlan`)

| Option | Behavior |
|--------|----------|
| default | Only sections missing from cache/DB (empty `{}` = missing) |
| `{ delta: true }` | Catalog deltas + stale + new team members (hourly) |
| `{ force: true }` | Catalog deltas + stale + full team member refresh |
| `{ full: true, bootstrap: true }` | Bootstrap all sections via delta (admin clear cache) |
| `{ sections: ["machines"] }` | Delta explicit section(s); `specials` expands to fortresses/endgames/prolabs |

Section order: `machines → fortresses → endgames → prolabs → tags → team → challenges`

On-demand: `ensureCachedTarget()` / `resolveEntWithEnsure()` for Pusher and Discord lookups.

## Environment

- **Docker**: copy `static/templates/.env.docker.example` → `.env`, use `npm run docker:up`
- Do **not** set `DATABASE_URL` in Docker — Compose injects `PGHOST`/`PGUSER`/`PGPASSWORD`
- `POSTGRES_PASSWORD` is fixed on first volume init; change requires `npm run docker:reset-db` or `ALTER USER`
- Optional API server vars only matter when `API_SERVER_ENABLED=true`

## Logging

Use `createLogger("module-name")` from `helpers/logger.js`. Logs go to console + `LOG_DIR/sevenbot.log` + `sevenbot-error.log`.

## Coding conventions

- CommonJS (`require`/`module.exports`), no TypeScript
- Code and comments in **English**; user-facing responses may use `static/strings.js`
- Reuse existing classes: `Format`, `Helpers`, `SevenDatastore`, `HtbEmbeds`, `Send`
- Discord embeds **must** have `.setDescription()` — empty description causes API 400
- Guard `Object.values()` on possibly-empty caches (`{}` not `undefined`)
- Minimize scope: match existing style, avoid over-abstraction

## Cursor resources

- Rules: `.cursor/rules/*.mdc` — auto-applied conventions per file type
- Skills: `.cursor/skills/*/SKILL.md` — workflows for HTB sync, Discord features, Docker, debugging

## Key admin commands (DialogFlow intents)

- `admin.forceUpdateData` → delta catalog sync + full team refresh (`force: true`)
- `admin.syncSection` → section delta (`seven sync machines`, etc.)
- `admin.clearCached` → wipe memory + full refresh (`full: true`)
- `admin.pusherStatus` → Pusher connection, announce queue, recent in-memory events
- `admin.htbTokenSet` → OAuth refresh or full pair (`seven htb token set …`)
- `admin.htbTokenStatus` → OAuth access expiry + persistence (`seven htb token status`)
- `captain.pusherHistory` / `captain.pusherRepost` → persisted notification log + forced announce repost (captain only)
- `getTeamInfo`, `getMemberRank`, `getTargetInfo`, … → see `bot.js` switch and [docs/developer/intents.md](docs/developer/intents.md)
- `list prolabs` (local NLP) → all pro labs, id ascending, `standard` / `mini` labels in embed

## References

- [Unofficial HTB API (Gubarz)](https://github.com/Gubarz/unofficial-htb-api) — machine list v5 endpoints
- [HTB API (D3vil0p3r)](https://github.com/D3vil0p3r/HackTheBox-API) — v4 endpoint reference
- [docs/developer/htb-api.md](docs/developer/htb-api.md) — Seven HTB integration reference
