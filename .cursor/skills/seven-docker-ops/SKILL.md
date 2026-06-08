---
name: seven-docker-ops
description: >-
  Deploy, configure, and operate Seven with Docker Compose. Use when setting up
  local dev, fixing Postgres auth, managing volumes, updating .env, or
  troubleshooting container startup and healthchecks.
---

# Seven Docker Operations

## First-time setup

```bash
cp static/templates/.env.docker.example .env
# Fill: BOT_TOKEN, HTB_V4_TOKEN, GOOGLE_APPLICATION_CREDENTIALS,
#       GOOGLE_CLOUD_PROJECT, DISCORD_*, HTB_TEAM_ID, POSTGRES_PASSWORD

npm run docker:up
npm run docker:logs
```

Expected startup logs:
- `[DB IMPORT]::: Restored from DB backup.`
- `[datastore] HTB data update started (partial bootstrap …)` or `skipped (cache complete)`
- `[DISCORD]::: CLIENT READY`

## Postgres password issues

**Symptom**: `password authentication failed for user "seven"`

**Cause**: `POSTGRES_PASSWORD` in `.env` changed after first `docker compose up`. Password is baked into volume `seven_pgdata`.

**Fix A** (wipe data):
```bash
npm run docker:reset-db
npm run docker:up
```

**Fix B** (keep data):
```bash
docker compose exec postgres psql -U seven -c "ALTER USER seven PASSWORD 'new_password';"
# Set same password in .env POSTGRES_PASSWORD
npm run docker:restart
```

## Common operations

| Task | Command |
|------|---------|
| Rebuild after code change | `npm run docker:build && npm run docker:restart` |
| View logs | `npm run docker:logs` |
| Stop | `npm run docker:down` |
| Wipe DB + logs volumes | `npm run docker:reset-db` |

## Environment checklist

- [ ] No `DATABASE_URL` in `.env` (compose injects `PGHOST=postgres`)
- [ ] `HTB_V4_TOKEN` is fresh App Token (not expired)
- [ ] `GOOGLE_APPLICATION_CREDENTIALS` is valid JSON (single line in `.env`)
- [ ] `API_SERVER_*` vars removed unless `API_SERVER_ENABLED=true`
- [ ] `LOG_DIR=/var/log/sevenbot` (matches compose volume)

## Dev instance

Copy `docker-compose.override.yml.example` → `docker-compose.override.yml`:
- Set `IS_DEV_INSTANCE=true` to restrict responses to developer
- Expose ports if needed

## Container security

- Read-only filesystem, dropped capabilities
- Logs persisted in `seven_logs` volume
- Node 20 + Chromium for chart rendering

## Local without Docker

```bash
# Use DATABASE_URL or PGHOST for Postgres
NODE_ENV=development node bot.js  # loads ./config/.env
```

## Troubleshooting startup hang

1. Check `[htb-api]` rate-limit wait logs — sync may be slow, not stuck
2. Step `[4/5] Fetching team` can take minutes for large teams
3. Increase log verbosity: `LOG_LEVEL=debug` in `.env`
4. Token issues: look for `Non-JSON HTML response` in `sevenbot-error.log`
