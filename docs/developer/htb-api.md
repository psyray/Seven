# HTB API Integration

Seven connects to Hack The Box using **v4-only App Token authentication**. The legacy password/session connector has been removed.

## Authentication

| Item | Value |
|------|-------|
| Token | `HTB_V4_TOKEN` — App Token from app.hackthebox.com → Settings → App Tokens |
| Header | `Authorization: Bearer <token>` on all v4 and v5 requests |
| Refresh | **Manual only** — regenerate on HTB and restart the bot |
| Expiry detection | JWT parse + HTML response detection when token is invalid |

### Removed (do not reintroduce)

- HTB v3 session/cookie authentication
- `HTB_LEGACY_*` credentials
- Password-based login or auto-refresh
- `.env_sample` template

## API version usage

| Data | API | Module method | Notes |
|------|-----|---------------|-------|
| Machine list | **v5** | `getMachinesV5()` | Paginated `machines?per_page=100&page=N&state=...` |
| Machine profiles | **v4** | `machine/profile/{id}` | Selective enrichment only |
| Challenges | v4 | Team/challenge endpoints | |
| Team / members | v4 | Team profile + member bulk | |
| Fortresses / endgames / prolabs | v4 | Stored in `MISC.*` | |
| Starting Point | v4 | `sp/tier/1..3` | Merged into `MACHINES` |

Base URLs in `config/htb.js`:

- `HTB_API_BASE` — v4 (default `https://labs.hackthebox.com/api/v4`)
- `HTB_API_V5_BASE` — v5 (default `https://labs.hackthebox.com/api/v5`)
- `HTB_APP_BASE` — app URLs (default `https://app.hackthebox.com`)

## Machine fetch strategy (hybrid v5 + v4)

Implemented in `modules/htb-api.js` → `getAllCompleteMachineProfiles()`:

1. **List** all machines via v5 pagination (active, retired, unreleased)
2. **Normalize** v5 fields to internal legacy shape (`normalizeV5Machine()`)
3. **Enrich** via v4 profile **only** when:
   - Machine is `retired`, OR
   - `user_owns_count > 0`, OR
   - `root_owns_count > 0`
4. **Concurrency** — `HTB_MACHINE_PROFILE_CONCURRENCY` (default 3)

This reduces v4 calls while keeping owned/retired machine data accurate.

## Rate limiting

- Reads `x-ratelimit-*` response headers
- Dynamic throttling with configurable log thresholds:
  - `HTB_RATE_LIMIT_WAIT_THRESHOLD_MS` (default 3000)
  - `HTB_RATE_LIMIT_LOG_EVERY_MS` (default 15000)
- Verbose mode: `HTB_API_LOG_REQUESTS=true`

## Sync orchestration

`models/SevenDatastore.js` → `DAT.update(options)`:

| Option | Behavior |
|--------|----------|
| Default | Only sections missing from cache/DB |
| `{ force: true }` | Team members + missing deps (machines/challenges/specials) |
| `{ full: true }` | All 5 sections |
| `{ sections: ["team"] }` | Explicit list, expanded via `getMemberSyncDependencies()` |

Section order: `machines → specials → tags → team → challenges`

Helper methods:

- `hasCachedObject()`, `getMissingSections()`, `describeUpdatePlan()` — logging
- `hydrateFromDbBackup()` — restore from Postgres on startup
- `syncDbExportFields()` — export top-level fortress/endgame/prolab fields for DB compat

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HTB_V4_TOKEN` | Yes | — | App Token |
| `HTB_TEAM_ID` | Yes* | — | Team ID |
| `HTB_UNIVERSITY_ID` | Alt* | — | University instead of team |
| `HTB_API_BASE` | No | labs v4 | v4 base URL |
| `HTB_API_V5_BASE` | No | labs v5 | v5 base URL |
| `HTB_APP_BASE` | No | app.htb.com | App URLs |
| `FOUNDER_HTB_ID` | No | — | Founder override |
| `HTB_LOG_PROGRESS_EVERY` | No | 25 | Progress log interval |
| `HTB_MACHINE_PROFILE_CONCURRENCY` | No | 3 | Parallel profile fetches |
| `HTB_API_LOG_REQUESTS` | No | false | Verbose API logs |
| `HTB_RATE_LIMIT_WAIT_THRESHOLD_MS` | No | 3000 | Rate-limit log threshold |
| `HTB_RATE_LIMIT_LOG_EVERY_MS` | No | 15000 | Rate-limit heartbeat |

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
DAT.DISCORD_LINKS     // Discord ↔ HTB (via D_STATIC)
```

## Postgres persistence

Table `seven_data`: JSON columns per entity type.

- `importDbBackup()` on startup
- `updateCache()` after sync

## Debugging

```bash
LOG_LEVEL=debug HTB_API_LOG_REQUESTS=true npm run docker:restart
```

Look for:

- `v5 list + selective v4 profiles` — machine phase
- `Non-JSON HTML response` — expired token
- Rate-limit wait heartbeats — slow but normal for large syncs

## References

- [Unofficial HTB API (Gubarz)](https://github.com/Gubarz/unofficial-htb-api) — machine list v5
- [HTB API (D3vil0p3r)](https://github.com/D3vil0p3r/HackTheBox-API) — v4 endpoints
- [Admin environment reference](../admin/environment.md)
