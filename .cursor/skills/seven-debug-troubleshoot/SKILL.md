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

Logger modules: `[bot]`, `[datastore]`, `[htb-sync]`, `[htb-api]`, `[pusher-htb]`, `[notification-router]`, `[notification-store]`

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
| `Non-JSON HTML response` | Expired/invalid OAuth token | Re-login; `seven set htb tokens` or update `HTB_TOKEN_FILE` + `HTB_ENV_FILE` |
| `No live own announces` | Pusher silent or bad Bearer token | `seven pusher status`; fallback poll should still catch owns — check logs |
| `embed.description required` | Empty embed path | Add `.setDescription()` in embeds.js |
| `Object.values` on null | Uninitialized cache | Guard with `\|\| {}` in resolveEnt |
| Sync stuck at 4/5 | Large team + rate limits | Normal — check rate-limit wait logs |
| DialogFlow entity error | Malformed flag data | Fix `extractSpecialTargetFlagNames()` |
| `password authentication failed` | Postgres volume password | See seven-docker-ops skill |
| 0 machines after clear cache | Token or API base wrong | Verify `HTB_API_BASE` and token |
| Token refresh fails on 2nd boot | Stale `.env` refresh vs `HTB_TOKEN_FILE` | Set both `HTB_TOKEN_FILE` + `HTB_ENV_FILE`; or `seven set htb tokens` |
| Owns missed at boot | Channel not ready yet | Should queue — verify `DISCORD_ANNOUNCE_CHAN_ID`; captain `seven pusher repost last` |
| Own in history but not in channel | Pusher silent or send failed | Captain: `seven pusher history` → note column; `seven pusher repost <id>` |
| Fortresses/Endgames/Pro Labs = 0 after boot | Empty `{}` in DB treated as missing — should delta-fetch on boot; check `[htb-sync]` logs | `seven sync fortresses` or `seven sync all`; verify HTB token |
| `list prolabs` shows wrong names (Trusted, Reflection…) | Default sort was id **desc** — newest mini labs first | Fixed: `list prolabs` uses id asc + `nolimit`; rebuild bot; `seven sync prolabs` if cache stale |
| Repost fails target/member | Target not on HTB or API error | Pusher auto-fetches via `ensureCachedTarget`; retry repost; check `seven pusher history` note column |
| No @mention on own | Account not linked | Link HTB↔Discord; check `PUSHER_MENTION_ON_OWN` |
| Lab own not parsed | HTML format change | `IS_DEV_INSTANCE=true` → inspect `LOG_DIR/PUSHER_MSG_LOG.json` (Docker) or `cache/PUSHER_MSG_LOG.json` (local); update parser |

## Pusher diagnostics

1. Admin: `seven pusher status` — connection state, queue size, recent in-memory events
2. Captain: `seven pusher history` — persisted rows in `seven_notification_events` (Postgres)
3. Captain recovery: `seven pusher repost last` or `seven pusher repost <id>` — bypasses filters/dedup; does not re-integrate HTB stats
4. Logs: `[pusher-htb]` state changes, `[notification-router]` fallback polls, `[notification-store]` schema/load warnings
5. Staging capture: `IS_DEV_INSTANCE=true` → `LOG_DIR/PUSHER_MSG_LOG.json` (Docker) or `cache/PUSHER_MSG_LOG.json` (local)
6. Parser regression: `npm run test:pusher`
7. Fallback: polls member activity every `PUSHER_FALLBACK_POLL_MS` (even when Pusher healthy)

See `docs/developer/pusher-events.md` for expected HTML formats.

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
- `seven force update` → delta catalogs + full team refresh
- `seven sync machines|challenges|fortresses|endgames|prolabs|specials|all` → section delta only
- `seven clear cache` (admin) → wipe memory + delta bootstrap
- `seven pusher status` (admin) → Pusher connection + announce queue

Captain commands:
- `seven pusher history [member]` → Postgres notification log
- `seven pusher repost last|<id>` → force announce embed (captain only)

## DialogFlow entity sync errors

```
Error updating entity type 'specialTargetFlagName'
Field [object Object] did not exist
```

→ Flag objects passed where strings expected. Use `getDialogflowSpecialTargetFlagNames()` which normalizes `title`/`name`/`flag_title`.

## Verification after fix

1. Restart: `npm run docker:restart`
2. Watch logs for `[htb-sync] Catalog delta` / `ensureTarget merged` (or skip message)
3. Test: `seven team info`, `seven <username> rank`, `seven <machine>`
4. Confirm `sevenbot-error.log` has no new entries

## Do not

- Log or commit tokens/secrets
- Assume password login or static App Token can refresh HTB session (removed — OAuth pair only)
- Run `docker:reset-db` without warning user about data loss
