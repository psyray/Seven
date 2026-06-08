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

## Sync behaviour (automatic)

| Trigger | Mode | Description |
|---------|------|-------------|
| Startup | Partial | Only fetches sections missing from cache/DB |
| Every hour | `{ force: true }` | Smart sync in background |
| `force update` | `{ force: true }` | Manual smart sync |
| `clear cache` | `{ full: true }` | Manual full refresh |

Section order: `machines → specials → tags → team → challenges`

## HTB token maintenance

The `HTB_V4_TOKEN` App Token **does not auto-refresh**.

When expired:

1. Generate a new token on [app.hackthebox.com](https://app.hackthebox.com)
2. Update `HTB_V4_TOKEN` in `.env`
3. `npm run docker:restart`

Symptoms: `Non-JSON HTML response` in `sevenbot-error.log`, bot stops answering HTB queries.

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
