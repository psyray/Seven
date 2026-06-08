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
  pusher-htb.js     Real-time HTB achievement notifications
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

## HTB API (v4-only auth)

- Auth: `HTB_V4_TOKEN` (App Token from app.hackthebox.com) — **no v3 session, no password login**
- v4 base: `https://labs.hackthebox.com/api/v4` (profiles, team, challenges, …)
- v5 base: `https://labs.hackthebox.com/api/v5` (machine list pagination)
- Token expiry: regenerate on app.hackthebox.com and restart — no auto-refresh

## Sync modes (`SevenDatastore.update`)

| Option | Behavior |
|--------|----------|
| default | Only sections missing from cache/DB |
| `{ force: true }` | Team members + any missing deps (machines/challenges/specials) |
| `{ full: true }` | All 5 sections (admin clear cache) |
| `{ sections: ["team"] }` | Explicit section list, expanded with deps |

Section order: `machines → specials → tags → team → challenges`

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

- `admin.forceUpdateData` → smart team sync (`force: true`)
- `admin.clearCached` → wipe memory + full refresh (`full: true`)
- `getTeamInfo`, `getMemberRank`, `getTargetInfo`, … → see `bot.js` switch and [docs/developer/intents.md](docs/developer/intents.md)

## References

- [Unofficial HTB API (Gubarz)](https://github.com/Gubarz/unofficial-htb-api) — machine list v5 endpoints
- [HTB API (D3vil0p3r)](https://github.com/D3vil0p3r/HackTheBox-API) — v4 endpoint reference
- [docs/developer/htb-api.md](docs/developer/htb-api.md) — Seven HTB integration reference
