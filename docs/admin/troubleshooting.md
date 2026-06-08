# Troubleshooting

Common failures when operating Seven.

## Bot won't start

### Postgres password authentication failed

```
password authentication failed for user "seven"
```

**Cause:** `POSTGRES_PASSWORD` in `.env` was changed after the first `docker compose up`. The password is baked into volume `seven_pgdata`.

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

### Container exits immediately

Check logs: `npm run docker:logs`

Common causes:

- Invalid `BOT_TOKEN`
- Malformed `GOOGLE_APPLICATION_CREDENTIALS` JSON
- Missing required env vars

## HTB sync failures

### Token expired or invalid

**Symptoms:**

- `Non-JSON HTML response for ...` in `sevenbot-error.log`
- Sync errors during startup
- Bot online but HTB queries fail

**Fix:**

1. Regenerate App Token at [app.hackthebox.com](https://app.hackthebox.com) → Settings → App Tokens
2. Update `HTB_V4_TOKEN` in `.env`
3. `npm run docker:restart`

There is **no automatic token refresh**. Plan to renew before expiry.

### Slow sync (not stuck)

Large teams can take several minutes. Watch for progress logs:

- `[htb-api]` rate-limit wait messages (normal)
- `[4/5] Fetching team` — member bulk fetch

Increase verbosity: `LOG_LEVEL=debug` in `.env`

Tune concurrency if rate-limited: lower `HTB_MACHINE_PROFILE_CONCURRENCY` (default 3).

### Partial cache after restart

Expected behaviour — Seven only fetches **missing** sections on startup. Use `seven force update` or `seven clear cache` if data seems stale.

## Discord issues

### Bot online but doesn't respond

- Verify **Message Content Intent** is enabled in Discord Developer Portal
- In channels, users must prefix with `seven` (not required in DMs)
- Check `IS_DEV_INSTANCE=true` — bot only responds to admins in dev mode

### Empty or broken embeds

Discord requires embed descriptions. If a new feature ships without `.setDescription()`, embeds fail with API 400. Check `sevenbot-error.log`.

### No achievement announcements

- Verify `DISCORD_ANNOUNCE_CHAN_ID` is correct
- Bot needs valid `HTB_V4_TOKEN` for Pusher auth
- Only team members in cache trigger notifications

## Charts not rendering

**Symptoms:** Member chart embeds appear without images.

**Causes:**

- `CHART_RENDER_DISABLED=1` is set
- Chromium not available (Docker image includes it; local dev needs Chromium)
- Puppeteer sandbox issues outside Docker

**Fix (Docker):** Ensure `PUPPETEER_EXECUTABLE_PATH=/usr/lib/chromium/chromium` (set by compose).

**Fix (local):** Install Chromium and set `PUPPETEER_EXECUTABLE_PATH` or `CHROMIUM_PATH`.

Debug mode: `NODE_ENV=chartdev` for visible browser.

## Dialogflow errors

- Verify `GOOGLE_CLOUD_PROJECT` matches your agent's project
- Service account needs Dialogflow API access
- Credentials must be valid single-line JSON in `.env`

Test locally: `SMOKE_LIVE_DF=1 npm run test:intents`

## Log locations

| File | Content |
|------|---------|
| `LOG_DIR/sevenbot.log` | General logs |
| `LOG_DIR/sevenbot-error.log` | Errors only |

Docker: logs persist in volume `seven_logs`. View via `npm run docker:logs` or:

```bash
docker compose exec seven tail -f /var/log/sevenbot/sevenbot-error.log
```

## Getting help

1. Collect relevant log excerpts (redact tokens!)
2. Note your `.env` structure (not values)
3. Open a [GitHub Issue](https://github.com/psyray/Seven/issues) with logs and steps to reproduce

## Related

- [Setup guide](setup.md)
- [Operations](operations.md)
- [Environment variables](environment.md)
