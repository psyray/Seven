# Administrator Guide

This guide is for team leaders and server admins who deploy and operate a Seven instance for their Hack The Box team.

## What you need

| Service | Purpose |
|---------|---------|
| **Discord** | Bot application, server, announce channel, emoji guild |
| **Hack The Box** | Team (or university), OAuth access + refresh tokens from labs.hackthebox.com |
| **Google Cloud** | Dialogflow agent + service account |
| **Docker host** | Runs Seven + PostgreSQL (recommended) |

## Architecture overview

```
Discord users → Seven bot (Node.js) → Dialogflow (NLP)
                         ↓
              HTB API v4/v5 (OAuth Bearer)
                         ↓
              PostgreSQL (seven_data cache + seven_notification_events)
                         ↓
              Pusher + activity fallback (real-time achievements)
```

Seven caches HTB data in memory and persists it to Postgres. On startup it restores from the database and syncs only missing sections from HTB.

## Quick start

```bash
cp static/templates/.env.docker.example .env
# Edit .env — see setup.md for each variable

npm run docker:up
npm run docker:logs
```

## Documentation map

| Topic | Guide |
|-------|-------|
| First-time deployment | [setup.md](setup.md) |
| All environment variables | [environment.md](environment.md) |
| Admin Discord commands | [operations.md](operations.md) |
| Failures and fixes | [troubleshooting.md](troubleshooting.md) |
| User-facing commands | [../user/commands.md](../user/commands.md) |

## Roles

Configure in `.env`:

- **`ADMIN_DISCORD_IDS`** — full admin access (clear cache, emoji, parrot mode, status)
- **`CAPTAIN_DISCORD_IDS`** — maintenance access (force update, section sync, pusher history)

Both are JSON arrays of Discord user IDs, e.g. `["123456789012345678"]`.

## Post-deployment checklist

- [ ] Bot appears online in Discord
- [ ] Startup logs show `[DISCORD]::: CLIENT READY`
- [ ] HTB sync completes (or skips with warm cache)
- [ ] Run `seven setup emoji` (admin) for HTB icons in embeds
- [ ] Run `seven force update` (captain) after roster changes, or `seven sync <section>` for targeted refresh
- [ ] Link your own HTB account: `seven I am <uid> on HTB`
- [ ] Verify announce channel receives test notification (optional)

## Support

- [CONTRIBUTING.md](../CONTRIBUTING.md) — for developers extending Seven
- [Troubleshooting](troubleshooting.md) — common deployment failures
- [GitHub Issues](https://github.com/psyray/Seven/issues)
