# Developer Guide

Technical documentation for contributing to Seven.

## Start here

| Document | Purpose |
|----------|---------|
| [CONTRIBUTING.md](../../CONTRIBUTING.md) | Setup, tests, PR workflow |
| [AGENTS.md](../../AGENTS.md) | Concise architecture for AI-assisted dev |
| [architecture.md](architecture.md) | Data flow and module map |
| [htb-api.md](htb-api.md) | HTB v4/v5 integration |
| [intents.md](intents.md) | Dialogflow intent → handler map |
| [charts.md](charts.md) | Puppeteer / Highcharts pipeline |
| [testing.md](testing.md) | Smoke tests and fixtures |
| [dialogflow.md](dialogflow.md) | GCP, entity sync, local NLP |
| [api/index.html](../api/index.html) | JSDoc API reference |

## Repository map

```
bot.js                  Discord client, intent routing, DB backup
models/
  SevenDatastore.js     In-memory HTB cache, sync, entity resolution
  api-classes.js        JSDoc typedefs
modules/
  htb-api.js            HTB API v4/v5 connector
  send.js               Message delivery (typing, embeds)
  seven-api-server.js   Optional Express API
  charts/               Highcharts image generation
views/embeds.js         HtbEmbeds — Discord embed builders
helpers/
  nlp.js                Local intent overrides (OAuth reload, pusher commands)
  env-tokens.js         Atomic OAuth sync to HTB_ENV_FILE
  dflow.js              DialogFlow entity sync
  pusher-htb.js         Real-time HTB notifications (parse)
  notification-router.js Announce routing, fallback, captain repost
  notification-store.js Postgres notification event log
  puppeteer-launch.js   Shared Chromium options
  smoke-*.js            Offline test infrastructure
  test-catalog.js       Help-derived test prompts
static/strings.js       In-bot help (user command source of truth)
config/htb.js           API base URLs
fixtures/smoke-cache.json  Frozen HTB cache for tests
```

## Key concepts

1. **SevenDatastore (`DAT`)** — single in-memory cache of HTB data, synced from API and persisted to Postgres.
2. **Intent routing** — DialogFlow resolves user text → intent name → `switch` in `bot.js`.
3. **Entity resolution** — `DAT.resolveEnt()` maps names to machines, challenges, members.
4. **Embeds** — `HtbEmbeds` (`EGI`) builds Discord embeds; `Send` delivers them with human-like delays.

## Cursor resources

- Rules: `.cursor/rules/*.mdc`
- Skills: `.cursor/skills/seven-*/SKILL.md`

## Related audiences

- [User docs](../user/README.md) — Discord command reference
- [Admin docs](../admin/README.md) — deployment and operations
