# Contributing to Seven

Thank you for helping improve Seven — a Discord bot for Hack The Box teams.

This guide covers the developer workflow. For architecture details, see [AGENTS.md](AGENTS.md). For deployment, see [docs/admin/setup.md](docs/admin/setup.md).

## Prerequisites

- **Node.js 20+** (matches the Docker image)
- **Docker Compose** (recommended for local dev)
- **Hack The Box OAuth tokens** — browser login on [labs.hackthebox.com](https://labs.hackthebox.com): `HTB_V4_TOKEN` + `HTB_REFRESH_TOKEN` (see [setup.md](docs/admin/setup.md))
- **Google Cloud Dialogflow** project with service account credentials
- **Discord bot** application and server permissions

## Getting started

```bash
git clone https://github.com/psyray/Seven.git
cd Seven
npm install

cp static/templates/.env.docker.example .env
# Fill BOT_TOKEN, HTB_V4_TOKEN, HTB_REFRESH_TOKEN, GOOGLE_*, DISCORD_*, HTB_TEAM_ID, POSTGRES_PASSWORD

npm run docker:up
npm run docker:logs
```

Expected startup logs:

- `[DB IMPORT]::: Restored from DB backup.`
- `[datastore] HTB data update started …` or `skipped (cache complete)`
- `[htb-sync] Catalog delta fetching` / `Catalog delta up to date` during sync
- `[DISCORD]::: CLIENT READY`

### Without Docker

```bash
# Postgres via DATABASE_URL or PGHOST/PGUSER/PGPASSWORD
cp static/templates/.env.docker.example config/.env
NODE_ENV=development node bot.js
```

## Project layout

```
bot.js              Entry point, Discord client, intent routing
models/             SevenDatastore, HTB cache and sync
modules/            HTB API, Send, charts, optional API server
views/              Discord embed builders (HtbEmbeds)
helpers/            Format, NLP, Pusher, Puppeteer, smoke tests
config/             HTB API URLs
static/strings.js   In-bot help text (source of truth for user commands)
docs/               User, admin, and developer documentation
```

See [AGENTS.md](AGENTS.md) for the full architecture and data flow.

## Development workflow

| Task | Command |
|------|---------|
| Rebuild after code change | `npm run docker:build && npm run docker:restart` |
| View logs | `npm run docker:logs` |
| Stop stack | `npm run docker:down` |
| Wipe DB volumes | `npm run docker:reset-db` |

### Dev instance

Copy `docker-compose.override.yml.example` → `docker-compose.override.yml` and set `IS_DEV_INSTANCE=true`. The bot then responds only to admins — useful for testing without disturbing a live server.

### Debugging

- Set `LOG_LEVEL=debug` in `.env`
- Logs: `LOG_DIR/sevenbot.log` and `sevenbot-error.log` (Docker volume `seven_logs`)
- HTB API verbose mode: `HTB_API_LOG_REQUESTS=true`
- Smoke trace in bot: `SMOKE_TRACE=1`

## Testing

Run offline smoke tests before opening a PR:

```bash
npm run test:all
```

| Script | Layer | Requirements |
|--------|-------|--------------|
| `npm run test:intents` | Local NLP + embed safety | None |
| `npm run test:handler` | Intent handlers with fixture cache | None |
| `npm run test:charts` | Puppeteer/Highcharts rendering | Chromium (included in Docker) |
| `npm run test:e2e` | Live Discord help audit | `SMOKE_DISCORD_TOKEN`, `SMOKE_BOT_USER_ID` |
| `npm run test:pusher` | Pusher HTML parser | `cache/PUSHER_SAMPLE_EVENTS.json` |

Optional live Dialogflow: `SMOKE_LIVE_DF=1 npm run test:intents`

Fixture data lives in `fixtures/smoke-cache.json`. Test prompts are derived from `static/strings.js` via `helpers/test-catalog.js`.

See [docs/developer/testing.md](docs/developer/testing.md) for details.

## Adding a new bot command

1. **Dialogflow** — create or extend an intent with training phrases and parameters.
2. **`bot.js`** — add a `case` in the intent switch and wire parameters from `P.*`.
3. **`views/embeds.js`** — add or reuse an embed builder in `HtbEmbeds` (`EGI.*`). Every embed **must** call `.setDescription()`.
4. **`static/strings.js`** — add examples to the relevant help section in `buildHelpMessages()`.
5. **Smoke tests** — add regression cases to `helpers/test-catalog.js` or `scripts/intent-smoke.js` if the intent has non-obvious parsing rules.

Workflow reference: `.cursor/skills/seven-discord-feature/SKILL.md`

## HTB API changes

Seven uses **OAuth access + refresh tokens** on the v4 API (`HTB_V4_TOKEN` + `HTB_REFRESH_TOKEN`). Automatic refresh via `POST /login/refresh`; persist with `HTB_TOKEN_FILE` + optional `HTB_ENV_FILE`. No password login, no v3 session, no static App Token without refresh.

- Machine **lists** come from **v5** (`modules/htb-api.js` → `getMachinesV5()`).
- Machine **profiles** are enriched via **v4** selectively (retired or owned machines).
- Pusher **fallback** uses `user/profile/activity/{id}` — not `team/activity`.
- Sync orchestration lives in `models/SevenDatastore.js`.

Do **not** reintroduce legacy connectors or `HTB_LEGACY_*` variables.

Full reference: [docs/developer/htb-api.md](docs/developer/htb-api.md)

## Coding conventions

- **CommonJS** — `require` / `module.exports`; no TypeScript
- **Logging** — `createLogger("module-name")` from `helpers/logger.js`
- **Code and comments** — English; user-facing copy in `static/strings.js`
- **Embeds** — always `.setDescription()` (empty description causes Discord API 400)
- **Empty caches** — guard `Object.values()` on possibly-empty objects (`{}` not `undefined`)
- **Scope** — match existing style; reuse `Format`, `Helpers`, `SevenDatastore`, `HtbEmbeds`, `Send`

## Documentation maintenance

When you change user-facing commands or environment variables:

| Source of truth | Update also |
|-----------------|-------------|
| `static/strings.js` | `docs/user/commands.md` |
| `.env.docker.example` | `docs/admin/environment.md` |
| `bot.js` intent switch | `docs/developer/intents.md` |

Regenerate API reference:

```bash
npm run doc:generate
```

Output goes to `docs/api/`. The Markdown hub in `docs/` is readable directly on GitHub.

## Pull requests

1. Keep changes focused — one feature or fix per PR when possible.
2. Run `npm run test:all` before submitting.
3. Do **not** commit `.env`, credentials, or secrets.
4. Write clear commit messages explaining **why**, not just what.
5. Update documentation when behavior, env vars, or commands change.

## Further reading

- [docs/](docs/) — documentation hub (user, admin, developer)
- [AGENTS.md](AGENTS.md) — architecture for AI-assisted development
- [docs/api/index.html](docs/api/index.html) — JSDoc API reference
