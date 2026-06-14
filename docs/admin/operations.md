# Operations

Day-to-day administration of a running Seven instance.

## Roles

| Role | Env variable | Capabilities |
|------|--------------|--------------|
| **Admin** | `ADMIN_DISCORD_IDS` | All commands including clear cache, emoji, parrot mode, status |
| **Captain** | `CAPTAIN_DISCORD_IDS` | Force update (smart sync) |
| **User** | Everyone else | Standard HTB queries |

Captains who are also in `ADMIN_DISCORD_IDS` get admin commands.

## Admin Discord commands

Natural language via DialogFlow — examples below.

### Force update (captain or admin)

```
seven force update
seven refresh team data
```

**Effect:** Smart sync (`DAT.update({ force: true })`):

- Refreshes team members
- Fetches any missing dependencies (machines, challenges, specials)
- Does **not** wipe existing cache or Postgres data

**When to use:** After roster changes, new members join, or rankings feel stale.

### Clear cache (admin only)

```
seven clear cache
```

**Effect:** Full refresh (`DAT.update({ full: true })`):

- Clears in-memory cache
- Re-fetches all five sections: machines → specials → tags → team → challenges
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

### Set HTB OAuth tokens (admin)

```
seven set htb tokens eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... def50200...
```

Hot-reloads both tokens in memory without restart. Also persists to `HTB_TOKEN_FILE` when configured.

### Pusher status (admin)

```
seven pusher status
```

Shows Pusher connection state, pending announce queue size, recent events, and API fallback poll status.

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
| `PUSHER_FALLBACK_POLL_MS` | `300000` | Poll `team/activity` when Pusher is unhealthy |

**Troubleshooting:**

- No live announces but bot online → run `seven pusher status`; check `HTB_V4_TOKEN` (Pusher auth uses the same Bearer token)
- Missed events after outage → fallback poll catches up; force `seven force update` for full member activity refresh
- Collect raw payloads in staging → set `IS_DEV_INSTANCE=true` and inspect `cache/PUSHER_MSG_LOG.json`

## Sync behaviour (automatic)

| Trigger | Mode | Description |
|---------|------|-------------|
| Startup | Partial | Only fetches sections missing from cache/DB |
| Every hour | `{ force: true }` | Smart sync in background |
| `force update` | `{ force: true }` | Manual smart sync |
| `clear cache` | `{ full: true }` | Manual full refresh |

Section order: `machines → specials → tags → team → challenges`

## HTB token maintenance

Seven uses OAuth access/refresh tokens. The access token (~72h) is renewed automatically before expiry.

When refresh fails (`HTB_REFRESH_TOKEN invalid`):

1. Re-login on [labs.hackthebox.com](https://labs.hackthebox.com) in a browser
2. Capture a new pair from DevTools → Network → `login/refresh`
3. Update `.env`, **or** write to `HTB_TOKEN_FILE`, **or** run in Discord: `seven set htb tokens <access> <refresh>`
4. Restart only if you edited `.env` directly: `npm run docker:restart`

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
