# Testing

Seven includes offline smoke tests that run without Discord or live HTB API access.

## Quick start

```bash
npm run test:all
```

Runs: `test:intents` → `test:handler` → `test:charts` → `test:pusher`

## Test layers

| Layer | Script | What it tests |
|-------|--------|---------------|
| 1 — Intents | `scripts/intent-smoke.js` | Local NLP, embed safety, help prompt catalog |
| 2 — Handlers | `scripts/handler-smoke.js` | Full intent handlers with fixture cache |
| 3 — Charts | `scripts/chart-smoke.js` | Puppeteer/Highcharts rendering |
| 4 — Pusher | `scripts/pusher-smoke.js` | HTB Pusher HTML parsing (`cache/PUSHER_SAMPLE_EVENTS.json`) |
| 5 — E2E (optional) | `scripts/e2e-help-audit.js` | Live Discord help audit |
| 6 — Logs (optional) | `scripts/analyze-seven-logs.js` | Parse smoke log output |

## Fixture data

`fixtures/smoke-cache.json` — frozen HTB cache loaded by `helpers/smoke-handler.js`. Allows handler tests without network.

Update fixtures when embed shapes or cache structure changes significantly.

## Test catalog

`helpers/test-catalog.js` derives test prompts from `static/strings.js` help text via `buildHelpPromptCatalog()`. This keeps smoke tests aligned with the in-bot manual.

When adding commands, update help in `strings.js` — prompts propagate automatically.

## Intent smoke (`npm run test:intents`)

Tests:

- Local intent regressions (`helpers/nlp.js` → `resolveLocalIntent()`)
- Embed builders don't throw with fixture data
- Help-derived prompts resolve safely

Optional live Dialogflow:

```bash
SMOKE_LIVE_DF=1 npm run test:intents
```

Requires valid `GOOGLE_APPLICATION_CREDENTIALS` and `GOOGLE_CLOUD_PROJECT`.

## Handler smoke (`npm run test:handler`)

Runs intent handlers through `helpers/smoke-handler.js` with fixture cache. Validates end-to-end handler logic without Discord.

## Chart smoke (`npm run test:charts`)

Renders sample charts via Puppeteer. Requires Chromium (included in Docker image).

## Pusher smoke (`npm run test:pusher`)

Parses sample HTB Pusher HTML payloads from `cache/PUSHER_SAMPLE_EVENTS.json` via `parsePusherEvent()`. Extend samples when HTB changes shoutbox HTML (see `docs/developer/pusher-events.md`).

## E2E help audit (`npm run test:e2e`)

Sends help-derived prompts to a live Discord channel and validates responses.

Required env:

| Variable | Description |
|----------|-------------|
| `SMOKE_DISCORD_TOKEN` | User token with channel access |
| `SMOKE_BOT_USER_ID` | Seven bot user ID |

Optional:

| Variable | Default | Description |
|----------|---------|-------------|
| `SMOKE_DELAY_MS` | 2500 | Delay between messages |
| `SMOKE_ROLE` | member | Help role to audit |
| `SMOKE_LIMIT` | 0 | Max prompts (0 = all) |
| `SMOKE_TRACE=1` | — | Enable trace logging in bot |

## Log analysis (`npm run test:logs`)

Parses bot logs for smoke test markers. Run after an E2E session.

## Smoke trace in bot

Set `SMOKE_TRACE=1` in `.env` when running E2E tests — bot logs `[SMOKE]` markers for correlation.

## CI

There is currently no CI pipeline in the repo. Run `npm run test:all` locally before opening PRs. See [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Adding tests for new commands

1. Add help examples to `static/strings.js` (auto-catalogued)
2. For non-obvious NLP, add cases to `scripts/intent-smoke.js`
3. For new embed shapes, verify with handler smoke
4. If chart-related, extend `scripts/chart-smoke.js`

## Related

- [CONTRIBUTING.md](../../CONTRIBUTING.md)
- [Intent reference](intents.md)
- [Charts](charts.md)
