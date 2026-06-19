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
- `[htb-sync] Catalog delta fetching` / `Catalog delta up to date` during sync
- `[DISCORD]::: CLIENT READY`

On first boot after upgrade, `NotificationStore.ensureSchema()` creates `seven_notification_events` in the same Postgres DB (persists Pusher/fallback history for captain `seven pusher history` / `repost`).

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
- [ ] `HTB_V4_TOKEN` + `HTB_REFRESH_TOKEN` from browser OAuth (not static App Token)
- [ ] `HTB_TOKEN_FILE` + `HTB_ENV_FILE=/config/seven.env` for Docker token rotation
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
NODE_ENV=development node bot.js  # loads ./.env
```

## Troubleshooting startup hang

1. Check `[htb-api]` / `[htb-sync]` rate-limit wait logs — sync may be slow, not stuck
2. Delta sync fetches only missing/stale catalog IDs — large first bootstrap is normal
3. Team section can take minutes for large rosters on `force update` (full member refresh)
4. Increase log verbosity: `LOG_LEVEL=debug` in `.env`
5. Token issues: look for `Non-JSON HTML response` in `sevenbot-error.log`
