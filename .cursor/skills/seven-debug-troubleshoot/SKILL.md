---
name: seven-debug-troubleshoot
description: >-
  Diagnose Seven bot failures using logs, cache state, and HTB API responses.
  Use when the bot returns errors, empty data, sync hangs, DialogFlow entity
  sync fails, or Discord embeds crash after HTB API changes.
---

# Seven Debug & Troubleshoot

## Log locations

| Source | Path |
|--------|------|
| Docker volume | `docker compose exec seven cat /var/log/sevenbot/sevenbot.log` |
| Errors only | `…/sevenbot-error.log` |
| Live tail | `npm run docker:logs` |
| Console | stdout in docker logs (winston mirrors to console) |

Logger modules: `[bot]`, `[datastore]`, `[htb-api]`, `[pusher-htb]`

## Diagnostic flow

```
1. Bot starts?
   NO  → check BOT_TOKEN, GOOGLE_APPLICATION_CREDENTIALS, node version
   YES → continue

2. DB connected?
   NO  → Postgres password / PGHOST mismatch
   YES → check [DB IMPORT] counts

3. Cache populated?
   Machines/Members = 0 → wait for sync or check HTB_V4_TOKEN
   Skipped sync → expected if DB backup has data

4. Discord responds?
   NO  → DISCORD_GUILD_ID, bot permissions, IS_DEV_INSTANCE
   YES but errors → check intent + embed description

5. HTB API errors?
   → sevenbot-error.log, regenerate HTB_V4_TOKEN
```

## Symptom → cause → fix

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Non-JSON HTML response` | Expired/invalid token | Regenerate `HTB_V4_TOKEN` |
| `embed.description required` | Empty embed path | Add `.setDescription()` in embeds.js |
| `Object.values` on null | Uninitialized cache | Guard with `\|\| {}` in resolveEnt |
| Sync stuck at 4/5 | Large team + rate limits | Normal — check rate-limit wait logs |
| DialogFlow entity error | Malformed flag data | Fix `extractSpecialTargetFlagNames()` |
| `password authentication failed` | Postgres volume password | See seven-docker-ops skill |
| 0 machines after clear cache | Token or API base wrong | Verify `HTB_API_BASE` and token |

## Useful debug env vars

```bash
LOG_LEVEL=debug
HTB_API_LOG_REQUESTS=true
HTB_LOG_PROGRESS_EVERY=10
```

## Cache inspection

Startup prints counts:
```
Machines   : N
Challenges : N
Members    : N
Linked DC  : N
```

Admin commands:
- `seven force update` → smart team sync
- `seven clear the cache` (admin) → full re-fetch

## DialogFlow entity sync errors

```
Error updating entity type 'specialTargetFlagName'
Field [object Object] did not exist
```

→ Flag objects passed where strings expected. Use `getDialogflowSpecialTargetFlagNames()` which normalizes `title`/`name`/`flag_title`.

## Verification after fix

1. Restart: `npm run docker:restart`
2. Watch logs through all 5 sync phases (or skip message)
3. Test: `seven team info`, `seven <username> rank`, `seven <machine>`
4. Confirm `sevenbot-error.log` has no new entries

## Do not

- Log or commit tokens/secrets
- Assume password login can refresh HTB token (removed — App Token only)
- Run `docker:reset-db` without warning user about data loss
