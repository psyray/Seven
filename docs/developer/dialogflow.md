# Dialogflow & NLP

Seven uses Google Dialogflow for natural language understanding, supplemented by local NLP overrides and entity sync from HTB cache data.

## Components

| File | Role |
|------|------|
| `bot.js` | Creates Dialogflow session per user, calls `detectIntent()` |
| `helpers/dflow.js` | Syncs HTB entity names to Dialogflow entities |
| `helpers/nlp.js` | Local intent resolution (`resolveLocalIntent`, `extractTargetNameFromMessage`) |
| `static/strings.js` | Help text (not Dialogflow, but related UX) |

## GCP setup

1. Enable Dialogflow API in Google Cloud Console
2. Create/import agent with intents matching `bot.js` switch cases — see [intents.md](intents.md)
3. Create service account with Dialogflow Client role
4. Download JSON credentials → `GOOGLE_APPLICATION_CREDENTIALS` (single line in `.env`)
5. Set `GOOGLE_CLOUD_PROJECT` to project ID

Session path: `dflow.projectAgentSessionPath(GOOGLE_CLOUD_PROJECT, message.author.id)` — one session per Discord user.

## Entity sync

`helpers/dflow.js` pushes cached HTB names to Dialogflow entities so the agent recognizes machine, challenge, and member names.

Entity sync runs after HTB data refresh. On dev instances (`IS_DEV_INSTANCE=true`), upstream entity updates may behave differently — use for testing only.

## Local NLP overrides

`helpers/nlp.js` provides `resolveLocalIntent()` which can:

- Correct misclassified intents (e.g. `"box cap info"` → `getTargetInfo` with target `cap`)
- Pre-resolve before Dialogflow fallback
- Extract target names from free-form messages

Pusher maintenance phrases (regex in `resolveLocalIntent()`):

- `set htb tokens <access> <refresh>` → admin OAuth hot-reload
- `pusher status` → admin status embed
- `pusher history` / `pusher history <member>` → captain DB history
- `pusher repost last` / `pusher repost <id>` → captain forced announce

Local NLP runs in smoke tests (`npm run test:intents`) without calling Dialogflow.

## Dev instance

`IS_DEV_INSTANCE=true` (via `docker-compose.override.yml`):

- Bot responds **only to admins** (`ADMIN_DISCORD_IDS`)
- Useful for testing Dialogflow changes without affecting live users

## Fallback flow

1. User message → Dialogflow `detectIntent()`
2. If intent matched → `bot.js` switch
3. If `Default Fallback Intent` → small talk response, then try `resolveEnt()` for direct name lookup
4. Local NLP may adjust intent/parameters before step 2

## Testing Dialogflow

Offline (default):

```bash
npm run test:intents
```

Live Dialogflow:

```bash
SMOKE_LIVE_DF=1 npm run test:intents
```

E2E with Discord:

```bash
SMOKE_DISCORD_TOKEN=... SMOKE_BOT_USER_ID=... npm run test:e2e
```

## Adding a new intent

1. **Dialogflow console** — create intent with training phrases and `@entity` parameters
2. **`bot.js`** — add matching `case "intent.name":`
3. **`static/strings.js`** — document for users
4. **`helpers/nlp.js`** — add local override if Dialogflow consistently misclassifies
5. **`helpers/dflow.js`** — update entity types if new entity categories needed

Workflow: `.cursor/skills/seven-discord-feature/SKILL.md`

## Troubleshooting

| Issue | Check |
|-------|-------|
| All queries fall through to fallback | `GOOGLE_CLOUD_PROJECT`, credentials JSON |
| Names not recognized | Entity sync — run `force update`, check `dflow.js` logs |
| Wrong intent | Add training phrases in Dialogflow or local override in `nlp.js` |
| Dev bot silent | `IS_DEV_INSTANCE=true` — only admins get responses |

## Related

- [Intent reference](intents.md)
- [Testing](testing.md)
- [Admin setup](../admin/setup.md)
