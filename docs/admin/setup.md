# Setup Guide

Step-by-step deployment of Seven with Docker Compose.

## 1. Discord bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications).
2. Create an application → **Bot** → copy the **token** → `BOT_TOKEN`.
3. Enable **Message Content Intent** (required for reading messages).
4. Invite the bot to your server with permissions: Read Messages, Send Messages, Embed Links, Add Reactions, Use External Emojis.
5. Collect IDs (enable Developer Mode in Discord settings):
   - **Guild ID** → `DISCORD_GUILD_ID`
   - **Announce channel ID** → `DISCORD_ANNOUNCE_CHAN_ID`
   - **Emoji guild ID** (can be same guild) → `EMOJI_GUILD_ID`
   - Your Discord user ID → add to `ADMIN_DISCORD_IDS` and `CAPTAIN_DISCORD_IDS`

## 2. Hack The Box authentication

Seven uses OAuth access/refresh tokens on the HTB v4 API. Both are **required** in `.env`.

### Obtain the OAuth token pair

1. Log in to [labs.hackthebox.com](https://labs.hackthebox.com) in a browser (HTB Account OAuth).
2. Open DevTools → **Network** tab.
3. Filter for `login/refresh` (or trigger a page load that refreshes the session).
4. Copy from the response JSON:
   - `message.access_token` → `HTB_V4_TOKEN`
   - `message.refresh_token` → `HTB_REFRESH_TOKEN`

The access token expires in ~72 hours; Seven refreshes it automatically via `POST /api/v4/login/refresh`.

### Optional: token persistence (Docker)

Compose sets `HTB_TOKEN_FILE=/var/log/sevenbot/htb_tokens.json` (volume `seven_logs`) and `HTB_ENV_FILE=/config/seven.env` (Compose mounts `./.env` read-write). Seven loads the JSON file **first** on startup and, after each OAuth refresh, updates both the JSON file and `.env` so restarts never reuse a stale refresh token alone:

```json
{
  "access_token": "...",
  "refresh_token": "..."
}
```

### Discord hot-reload (no restart)

When persistence is configured (`HTB_TOKEN_FILE` / `HTB_ENV_FILE`), you can update tokens from Discord (admin, use DM):

```
seven htb token status
seven htb token set <refresh>
seven htb token refresh
seven htb token set <access_jwt> <refresh>
```

Capture tokens from DevTools → Network → `login/refresh` on [labs.hackthebox.com](https://labs.hackthebox.com). See [operations.md](operations.md#htb-oauth-tokens-admin).

### Team ID

4. Set `HTB_TEAM_ID` to your team's numeric ID (from the team URL on HTB).
5. Optionally set `FOUNDER_HTB_ID` if auto-detection fails.

For university deployments, use `HTB_UNIVERSITY_ID` instead of `HTB_TEAM_ID`.

## 3. Google Dialogflow

1. Create a GCP project with Dialogflow API enabled.
2. Create or import the Seven agent (matching intents in `bot.js`).
3. Create a service account with Dialogflow permissions.
4. Download JSON credentials → paste as single-line JSON in `GOOGLE_APPLICATION_CREDENTIALS`.
5. Set `GOOGLE_CLOUD_PROJECT` to your GCP project ID.

## 4. Environment file

```bash
cp static/templates/.env.docker.example .env
```

Fill all required variables. See [environment.md](environment.md) for the complete reference.

**Important:**

- Do **not** set `DATABASE_URL` in Docker — Compose injects `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`.
- Choose a strong `POSTGRES_PASSWORD` — it is fixed on first database init.

## 5. Start Seven

```bash
npm install          # if running scripts locally
npm run docker:up
npm run docker:logs
```

### Expected startup sequence

1. `[DB IMPORT]::: Restored from DB backup.` (or empty on first run)
2. `NotificationStore.ensureSchema()` — creates `seven_notification_events` if missing
3. `[datastore] HTB data update started (partial bootstrap …)` or `skipped (cache complete)`
4. Machine sync: `v5 list + selective v4 profiles`
5. Team/challenges sync (may take minutes for large teams)
6. `[DISCORD]::: CLIENT READY`

Optional verification (admin): `seven pusher status` — Pusher connection and fallback poll stats.

## 6. Post-setup commands

In Discord (as admin):

```
seven setup emoji
```

As captain or admin:

```
seven force update
seven sync all
```

Link your account:

```
seven I am <your_htb_uid> on HTB
```

## 7. Dev instance (optional)

For testing without affecting a live server:

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
# Sets IS_DEV_INSTANCE=true — bot responds only to admins
npm run docker:restart
```

## 8. Verify

- Ask `seven help` — should return the manual.
- Ask `seven team info` — should show your team embed.
- Check announce channel when a teammate roots a box (requires linked Discord accounts for pings).

## Further reading

- [Environment variables](environment.md)
- [Operations](operations.md)
- [Troubleshooting](troubleshooting.md)
