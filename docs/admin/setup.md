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

## 2. Hack The Box App Token

Seven uses **v4-only authentication**. There is no HTB password login.

1. Log in to [app.hackthebox.com](https://app.hackthebox.com).
2. Profile → Settings → **App Tokens** → generate a new token.
3. Copy to `HTB_V4_TOKEN` in `.env`.
4. Set `HTB_TEAM_ID` to your team's numeric ID (from the team URL on HTB).
5. Optionally set `FOUNDER_HTB_ID` if auto-detection fails.

**Token expiry:** App Tokens expire. When expired, sync fails with HTML errors in logs. Regenerate the token on HTB and restart: `npm run docker:restart`.

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
2. `[datastore] HTB data update started (partial bootstrap …)` or `skipped (cache complete)`
3. Machine sync: `v5 list + selective v4 profiles`
4. Team/challenges sync (may take minutes for large teams)
5. `[DISCORD]::: CLIENT READY`

## 6. Post-setup commands

In Discord (as admin):

```
seven setup emoji
```

As captain or admin:

```
seven force update
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
