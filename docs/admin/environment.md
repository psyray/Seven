# Environment Variables

Complete reference for Seven's `.env` configuration. Template: `static/templates/.env.docker.example`.

## PostgreSQL (Docker)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_USER` | Yes | `seven` | Database user |
| `POSTGRES_PASSWORD` | Yes | — | Password — **fixed on first volume init** |
| `POSTGRES_DB` | Yes | `seven` | Database name |

Do **not** set `DATABASE_URL` when using Docker Compose. Compose injects `PGHOST=postgres`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`.

For local non-Docker dev, use `DATABASE_URL` or individual `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`.

## Discord

| Variable | Required | Description |
|----------|----------|-------------|
| `BOT_TOKEN` | Yes | Discord bot token |
| `ADMIN_DISCORD_IDS` | Yes | JSON array of admin Discord user IDs |
| `CAPTAIN_DISCORD_IDS` | Yes | JSON array of captain Discord user IDs |
| `DISCORD_GUILD_ID` | Yes | Primary guild ID |
| `DISCORD_ANNOUNCE_CHAN_ID` | Yes | Channel for achievement announcements |
| `EMOJI_GUILD_ID` | Yes | Guild where HTB custom emoji are installed |

Example: `ADMIN_DISCORD_IDS=["123456789012345678"]`

## Pusher notifications

Optional tuning for real-time own announcements. Defaults enable all own types except respects/joins/shoutbox.

| Variable | Default | Description |
|----------|---------|-------------|
| `PUSHER_MENTION_ON_OWN` | `true` | Discord @mention when HTB account is linked |
| `PUSHER_ANNOUNCE_USER_FLAGS` | `true` | Machine user-flag owns |
| `PUSHER_ANNOUNCE_ROOT_FLAGS` | `true` | Machine root owns |
| `PUSHER_ANNOUNCE_CHALLENGES` | `true` | Challenge solves |
| `PUSHER_ANNOUNCE_LABS` | `true` | Endgame / Fortress / Pro Lab flags |
| `PUSHER_ANNOUNCE_LAUNCHES` | `true` | Machine launch announcements |
| `PUSHER_ANNOUNCE_BADGES` | `true` | Badge notifications (team members) |
| `PUSHER_ANNOUNCE_RESPECTS` | `false` | Respect notifications |
| `PUSHER_ANNOUNCE_JOINS` | `false` | HTB registration join notifications |
| `PUSHER_ANNOUNCE_SHOUTBOX` | `false` | Global shoutbox relay |
| `PUSHER_DB_PERSIST_DEBOUNCE_MS` | `30000` | Debounce before Postgres persist after owns |
| `PUSHER_FALLBACK_POLL_MS` | `300000` | `team/activity` poll interval when Pusher is down |

## Hack The Box (v4 API — OAuth)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HTB_V4_TOKEN` | Yes | — | OAuth access token (JWT) from browser login |
| `HTB_REFRESH_TOKEN` | Yes | — | OAuth refresh token (`def50200...`) |
| `HTB_TOKEN_FILE` | No | — | JSON file path for persistence and hot-reload (loaded first on startup) |
| `HTB_ENV_FILE` | No | — | `.env` path updated after each OAuth refresh (Docker: `/config/seven.env`) |
| `HTB_TOKEN_EXPIRY_WARN_DAYS` | No | `1` | Alert admins this many days before access expiry |
| `HTB_API_BASE` | No | `https://labs.hackthebox.com/api/v4` | v4 API base URL |
| `HTB_API_V5_BASE` | No | `https://labs.hackthebox.com/api/v5` | v5 API base (machine lists) |
| `HTB_APP_BASE` | No | `https://app.hackthebox.com` | App URLs for profiles/badges |
| `HTB_TEAM_ID` | Yes* | — | HTB team ID for member sync |
| `HTB_UNIVERSITY_ID` | Alt* | — | University ID instead of team |
| `FOUNDER_HTB_ID` | No | — | Override team founder HTB user ID |

\* One of `HTB_TEAM_ID` or `HTB_UNIVERSITY_ID` is required.

### HTB tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `HTB_LOG_PROGRESS_EVERY` | `25` | Log progress every N items during bulk fetch |
| `HTB_MACHINE_PROFILE_CONCURRENCY` | `3` | Parallel v4 profile fetches during machine sync |
| `HTB_API_LOG_REQUESTS` | `false` | Verbose API request logging |
| `HTB_RATE_LIMIT_WAIT_THRESHOLD_MS` | `3000` | Min wait before logging rate-limit pause |
| `HTB_RATE_LIMIT_LOG_EVERY_MS` | `15000` | Heartbeat interval during rate-limit waits |

## Google Dialogflow

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Yes | Service account JSON (single line in `.env`) |
| `GOOGLE_CLOUD_PROJECT` | Yes | GCP project ID |

## Logging

| Variable | Default (Docker) | Description |
|----------|------------------|-------------|
| `LOG_DIR` | `/var/log/sevenbot` | Log file directory |
| `LOG_LEVEL` | `info` | Winston log level (`debug`, `info`, `warn`, `error`) |

## Charts & Puppeteer

Set by Docker Compose automatically:

| Variable | Docker value | Description |
|----------|--------------|-------------|
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/lib/chromium/chromium` | Chromium binary |
| `CHROME_USER_DATA_DIR` | `/tmp/chrome-user-data` | Headless Chrome profile |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | `true` | Use system Chromium in Docker |

Optional overrides:

| Variable | Description |
|----------|-------------|
| `CHART_RENDER_DISABLED` | Set to `1` to disable chart rendering |
| `CHROMIUM_PATH` | Alternative to `PUPPETEER_EXECUTABLE_PATH` |
| `HC_FONT_STRING` | Highcharts font family |
| `HC_FONT_SIZE` | Highcharts font size |
| `NODE_ENV=chartdev` | Non-headless Puppeteer for chart debugging |

## Optional API server

| Variable | Description |
|----------|-------------|
| `API_SERVER_ENABLED` | Set to `true` to enable Express API |
| `API_SERVER_PORT` | Port (default `666`) |
| `API_SERVER_URL` | Public URL for OAuth callback |
| `API_SERVER_DISCORD_CLIENT_ID` | Discord OAuth client ID |
| `API_SERVER_DISCORD_CLIENT_SECRET` | Discord OAuth secret |

## Development & smoke tests

| Variable | Description |
|----------|-------------|
| `IS_DEV_INSTANCE` | `true` — bot responds only to admins |
| `NODE_ENV` | `development` loads `config/.env`; `production` in Docker |
| `SMOKE_TRACE` | `1` — log smoke test messages in bot |
| `SMOKE_LIVE_DF` | `1` — call live Dialogflow in intent-smoke |
| `SMOKE_DISCORD_TOKEN` | User token for E2E help audit |
| `SMOKE_BOT_USER_ID` | Bot user ID for E2E tests |
| `SMOKE_DELAY_MS` | Delay between E2E messages (default `2500`) |
| `SMOKE_ROLE` | Help role for E2E (`member`, `captain`, `admin`) |
| `SMOKE_LIMIT` | Max E2E prompts (0 = unlimited) |

## Removed variables (do not use)

- `HTB_LEGACY_*` — legacy connector removed
- HTB password / v3 session credentials
- `.env_sample` — replaced by `static/templates/.env.docker.example`

## Related

- [Setup guide](setup.md)
- [Troubleshooting](troubleshooting.md)
- [HTB API developer reference](../developer/htb-api.md)
