# HTB API Reference for Seven

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HTB_V4_TOKEN` | Yes | App Token from app.hackthebox.com → Settings → App Tokens |
| `HTB_API_BASE` | No | v4 base URL (default labs.hackthebox.com/api/v4) |
| `HTB_API_V5_BASE` | No | v5 base URL (machine list) |
| `HTB_APP_BASE` | No | App URLs for profiles/badges |
| `HTB_TEAM_ID` | Yes* | Team ID for member sync |
| `HTB_UNIVERSITY_ID` | Alt | University instead of team |
| `FOUNDER_HTB_ID` | No | Team founder override |
| `HTB_LOG_PROGRESS_EVERY` | No | Progress log interval (default 25) |
| `HTB_MACHINE_PROFILE_CONCURRENCY` | No | Parallel profile fetches (default 3) |
| `HTB_API_LOG_REQUESTS` | No | Verbose API logging |
| `HTB_RATE_LIMIT_WAIT_THRESHOLD_MS` | No | Min wait before logging (default 3000) |
| `HTB_RATE_LIMIT_LOG_EVERY_MS` | No | Heartbeat during waits (default 15000) |

## API version usage

| Data | API version | Notes |
|------|-------------|-------|
| Machine list | v5 | Paginated, `machines?...` |
| Machine profiles | v4 | Selective enrichment for retired/owned |
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

## Postgres backup

Table `seven_data`: JSON columns per entity type. `importDbBackup()` on startup, `updateCache()` after sync.

## Removed (do not reintroduce)

- HTB v3 session/cookie authentication
- `HTB_LEGACY_*` credentials
- Password-based token refresh
- `.env_sample` template (use `.env.docker.example`)
