# HTB API Reference for Seven

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HTB_V4_TOKEN` | Yes | OAuth access JWT from browser `login/refresh` |
| `HTB_REFRESH_TOKEN` | Yes | OAuth refresh token (`def50200...`) |
| `HTB_TOKEN_FILE` | No | JSON path — **loaded first** on startup; updated after each refresh |
| `HTB_ENV_FILE` | No | `.env` path synced after refresh via `helpers/env-tokens.js` |
| `HTB_TOKEN_EXPIRY_WARN_DAYS` | No | Days before access expiry to alert (default 1) |
| `HTB_API_BASE` | No | v4 base URL (default labs.hackthebox.com/api/v4) |
| `HTB_API_V5_BASE` | No | v5 base URL (machine list) |
| `HTB_APP_BASE` | No | App URLs for profiles/badges/Pusher auth |
| `HTB_TEAM_ID` | Yes* | Team ID for member sync |
| `HTB_UNIVERSITY_ID` | Alt | University instead of team |
| `FOUNDER_HTB_ID` | No | Team founder override |
| `HTB_LOG_PROGRESS_EVERY` | No | Progress log interval (default 25) |
| `HTB_MACHINE_PROFILE_CONCURRENCY` | No | Parallel profile fetches (default 3) |
| `HTB_API_LOG_REQUESTS` | No | Verbose API logging |
| `HTB_RATE_LIMIT_WAIT_THRESHOLD_MS` | No | Min wait before logging (default 3000) |
| `HTB_RATE_LIMIT_LOG_EVERY_MS` | No | Heartbeat during waits (default 15000) |

## Auth flow

1. Startup: load `HTB_TOKEN_FILE` if present, else `.env` pair
2. Before requests: refresh if access expires within 120s (`POST /login/refresh`)
3. After refresh: persist JSON + optional `HTB_ENV_FILE` atomic update
4. Hot-reload: `seven set htb tokens <access> <refresh>` or `fs.watchFile(HTB_TOKEN_FILE)`
5. Failure: `HtbAuthError` — bot stays online; captains notified via Discord DM

## API version usage

| Data | API version | Notes |
|------|-------------|-------|
| Machine list | v5 | Paginated, `machines?...` |
| Machine profiles | v4 | Selective enrichment for retired/owned |
| Member activity (Pusher fallback) | v4 | `user/profile/activity/{id}` — **not** `team/activity` (401 on OAuth) |
| Challenges | v4 | |
| Team/members | v4 | |
| Fortresses/endgames/prolabs | v4 | Stored in `MISC.*` |
| Starting point machines | v4 | Merged into `MACHINES` |

## Cache shape

```javascript
DAT.MACHINES          // { [id]: Machine }
DAT.CHALLENGES        // { [id]: Challenge }
DAT.TEAM_MEMBERS      // { [id]: TeamMember }
DAT.TEAM_STATS        // Team object
DAT.MISC.FORTRESSES   // { [id]: Fortress }
DAT.MISC.ENDGAMES     // { [id]: Endgame }
DAT.MISC.PROLABS      // { [id]: ProLab }
DAT.MISC.MACHINE_TAGS // tag categories
DAT.DISCORD_LINKS     // Discord ↔ HTB associations
```

## Postgres tables

| Table | Purpose |
|-------|---------|
| `seven_data` | HTB cache JSON blobs — `importDbBackup()` / `updateCache()` |
| `seven_notification_events` | Pusher/fallback log — `NotificationStore` (not HTB sync) |

## Removed (do not reintroduce)

- HTB v3 session/cookie authentication
- App Token without refresh (`app.hackthebox.com` static tokens)
- Password-based token refresh / Turnstile login in bot
- `HTB_LEGACY_*`, `HTB_AUTH_*`, `HTB_SERVICE_*`
- `.env_sample` template (use `.env.docker.example`)
