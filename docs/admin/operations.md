# Operations

Day-to-day administration of a running Seven instance.

## Roles

| Role | Env variable | Capabilities |
|------|--------------|--------------|
| **Admin** | `ADMIN_DISCORD_IDS` | All commands including clear cache, emoji, parrot mode, status |
| **Captain** | `CAPTAIN_DISCORD_IDS` | Force update; notification history (`pusher history`); forced repost (`pusher repost`) |
| **User** | Everyone else | Standard HTB queries |

Captains who are also in `ADMIN_DISCORD_IDS` get admin commands.

## Admin Discord commands

Natural language via DialogFlow — examples below.

### Force update (captain or admin)

```
seven force update
seven refresh team data
```

**Effect:** Delta sync (`DAT.update({ force: true })`):

- Refreshes catalog deltas (machines, challenges, fortresses, endgames, pro labs) including stale entries
- Re-fetches **all** team member profiles
- Does **not** wipe existing cache or Postgres data

**When to use:** After roster changes, new members join, or rankings feel stale.

### Sync section (captain or admin)

```
seven sync machines
seven sync fortresses
seven sync endgames
seven sync prolabs
seven sync challenges
seven sync specials
seven sync all
```

**Effect:** Delta sync for the requested section(s) only — compares API catalog with cache and fetches missing/stale entries.

### Clear cache (admin only)

```
seven clear cache
```

**Effect:** Full bootstrap (`DAT.update({ full: true, bootstrap: true })`):

- Clears in-memory cache
- Delta-fetches all sections from HTB API (same code path as incremental sync, but from empty cache)
- Persists to Postgres after sync
- Does **not** wipe the Postgres volume — data is re-imported after refresh

**When to use:** Suspected corrupt cache, major HTB API changes, or admin troubleshooting.

### Set status (admin)

```
seven set status playing Hack The Box
```

Updates the bot's Discord presence/activity.

### Custom emoji (admin)

```
seven setup emoji
seven clear emoji
```

Installs or removes HTB-related custom emoji on `EMOJI_GUILD_ID` for richer embeds.

### Parrot mode (admin)

```
seven parrot on
seven parrot off
```

Relays channel messages to the first admin's DM — useful for debugging what users send. Off by default.

### HTB OAuth tokens (admin)

```
seven htb token status
seven htb token set def50200...
seven htb token refresh
seven htb token set eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... def50200...
```

- **status** — access expiry, refresh presence, persistence paths
- **set &lt;refresh&gt;** — renew access via HTB `login/refresh` (refresh token only; use DM; paste full token)
- **refresh** — renew access using the refresh token already in memory
- **set &lt;access_jwt&gt; &lt;refresh&gt;** — hot-reload full pair without restart (recommended)

Persists to `HTB_TOKEN_FILE` and syncs `HTB_ENV_FILE` when configured (Docker: `./.env`). Legacy alias: `set htb tokens <access> <refresh>` (pair only).

### Pusher status (admin)

```
seven pusher status
```

Shows Pusher connection state, pending announce queue size, recent in-memory events, and API fallback poll status.

### Notification history & repost (captain)

```
seven pusher history
seven pusher history psyray
seven pusher repost last
seven pusher repost 42
```

Captain only (`CAPTAIN_DISCORD_IDS`). Reads persisted rows from `seven_notification_events`; repost sends the own embed to `DISCORD_ANNOUNCE_CHAN_ID` without re-integrating HTB stats (safe to retry after a missed announce).

## Real-time notifications (Pusher)

Seven announces team owns (and global first blood) on `DISCORD_ANNOUNCE_CHAN_ID` via HTB Pusher. See [developer/pusher-events.md](../developer/pusher-events.md) for HTML formats.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PUSHER_MENTION_ON_OWN` | `true` | Discord @mention on owns when HTB account is linked |
| `PUSHER_ANNOUNCE_USER_FLAGS` | `true` | Announce machine user flags |
| `PUSHER_ANNOUNCE_ROOT_FLAGS` | `true` | Announce machine root flags |
| `PUSHER_ANNOUNCE_CHALLENGES` | `true` | Announce challenge solves |
| `PUSHER_ANNOUNCE_LABS` | `true` | Endgame / Fortress / Pro Lab flags |
| `PUSHER_ANNOUNCE_LAUNCHES` | `true` | New machine launches |
| `PUSHER_ANNOUNCE_BADGES` | `true` | Badge notifications for team members |
| `PUSHER_ANNOUNCE_RESPECTS` | `false` | Respect notifications |
| `PUSHER_ANNOUNCE_JOINS` | `false` | HTB account join notifications |
| `PUSHER_DB_PERSIST_DEBOUNCE_MS` | `30000` | Delay before writing Pusher cache updates to Postgres |
| `PUSHER_FALLBACK_POLL_MS` | `300000` | Poll `user/profile/activity` per team member (runs even when Pusher is healthy) |

**Troubleshooting:**

- No live announces but bot online → run `seven pusher status`; check `HTB_V4_TOKEN` (Pusher auth uses the same Bearer token)
- Missed events after outage → fallback poll catches up; captain runs `seven pusher history` and `seven pusher repost <id>` if needed
- Target/member not resolved on repost → Pusher auto-fetches missing targets via `ensureCachedTarget`; retry repost if needed
- Collect raw payloads in staging → set `IS_DEV_INSTANCE=true` and inspect `LOG_DIR/PUSHER_MSG_LOG.json` (Docker volume `seven_logs`) or `cache/PUSHER_MSG_LOG.json` locally

## Sync behaviour (automatic)

| Trigger | Mode | Description |
|---------|------|-------------|
| Startup | Partial bootstrap | Delta-fetch only sections missing from cache/DB (empty `{}` counts as missing) |
| Every hour | `{ delta: true }` | Catalog deltas + stale refresh + new team members only |
| `force update` | `{ force: true }` | Catalog deltas + stale + full team member refresh |
| `seven sync <section>` | `{ sections: [...] }` | Delta sync for one section |
| `clear cache` | `{ full: true, bootstrap: true }` | Wipe memory then delta bootstrap |

Section order: `machines → fortresses → endgames → prolabs → tags → team → challenges`

On-demand: Pusher and Discord entity lookup call `ensureCachedTarget()` before skipping.

## HTB token maintenance

Seven uses OAuth access/refresh tokens. The access token (~72h) is renewed automatically before expiry. HTB rotates the refresh token on each refresh — Seven persists the new pair to `HTB_TOKEN_FILE` and, when configured, syncs `HTB_V4_TOKEN` / `HTB_REFRESH_TOKEN` back into `.env` via `HTB_ENV_FILE` (Docker Compose mounts `./.env` at `/config/seven.env`).

When refresh fails (`HTB_REFRESH_TOKEN invalid`):

1. Re-login on [labs.hackthebox.com](https://labs.hackthebox.com) in a browser
2. Capture a **new** pair from DevTools → Network → `login/refresh` (same response for both tokens)
3. Update `.env`, **or** run in Discord (admin DM):
   - `seven htb token set <access> <refresh>` — full pair (recommended)
   - `seven htb token set <refresh>` — if you only have a valid refresh token
   - `seven htb token refresh` — renew using stored refresh (when still valid)
4. Restart only if you edited `.env` manually without a running bot sync: `npm run docker:restart`

Proactive warnings are sent to `DISCORD_ANNOUNCE_CHAN_ID` when access expiry is within `HTB_TOKEN_EXPIRY_WARN_DAYS` (default 1).

Symptoms: `HTB_REFRESH_TOKEN invalid` or `Non-JSON HTML response` in `sevenbot-error.log`, sync commands fail but the bot stays online and cache queries still work.

## Docker operations

| Task | Command |
|------|---------|
| View logs | `npm run docker:logs` |
| Restart bot | `npm run docker:restart` |
| Rebuild after code update | `npm run docker:build && npm run docker:restart` |
| Stop | `npm run docker:down` |
| Wipe DB (destructive) | `npm run docker:reset-db` |

## Postgres notes

- Password is set on **first** volume init only.
- Changing `POSTGRES_PASSWORD` in `.env` later does not update the existing volume.
- Fix: `npm run docker:reset-db` (wipes data) or `ALTER USER` inside Postgres — see [troubleshooting.md](troubleshooting.md).

## Optional API server

When `API_SERVER_ENABLED=true`, Seven exposes an Express control panel. Requires additional `API_SERVER_*` variables. Not needed for standard Discord usage.

## Related

- [Setup guide](setup.md)
- [Environment variables](environment.md)
- [Troubleshooting](troubleshooting.md)
- [User commands](../user/commands.md)
