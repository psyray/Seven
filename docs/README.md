# Seven Documentation

Seven is an AI-powered Discord bot for [Hack The Box](https://www.hackthebox.com) teams. This folder contains documentation for every audience.

## Choose your path

### For Discord users

Using Seven in your HTB team channel? Start here:

- [User guide](user/README.md) — how to talk to Seven
- [Commands reference](user/commands.md) — full command catalogue
- [Privacy & linking](user/privacy.md) — connect Discord to HTB, opt out
- [Examples](user/examples.md) — sample queries
- [Notifications](user/notifications.md) — achievement announcements

You can also type `seven help` in Discord for the built-in manual.

### For server administrators

Deploying and operating your own Seven instance:

- [Admin overview](admin/README.md) — prerequisites and architecture
- [Setup guide](admin/setup.md) — step-by-step deployment with Docker
- [Environment variables](admin/environment.md) — complete `.env` reference
- [Operations](admin/operations.md) — admin commands, sync modes, roles
- [Troubleshooting](admin/troubleshooting.md) — common failures and fixes

### For contributors

Developing or extending Seven:

- [CONTRIBUTING.md](../CONTRIBUTING.md) — getting started, tests, PR workflow
- [Developer guide](developer/README.md) — architecture and module index
- [HTB API integration](developer/htb-api.md) — v4/v5 auth and sync
- [Pusher event formats](developer/pusher-events.md) — real-time notification HTML
- [Intent reference](developer/intents.md) — Dialogflow intent → handler map
- [Charts & Puppeteer](developer/charts.md) — image rendering pipeline
- [Testing](developer/testing.md) — smoke tests and fixtures
- [Dialogflow & NLP](developer/dialogflow.md) — GCP setup and local NLP
- [AGENTS.md](../AGENTS.md) — concise architecture for AI-assisted dev

### API reference (JSDoc)

Auto-generated from source code:

- [docs/api/index.html](api/index.html) — browse modules and classes in a browser

Regenerate after code changes: `npm run doc:generate`

## Quick links

| Topic | Location |
|-------|----------|
| Docker deployment | [admin/setup.md](admin/setup.md) |
| HTB OAuth tokens | [admin/setup.md#hack-the-box-authentication](admin/setup.md#2-hack-the-box-authentication) |
| Force update vs clear cache | [admin/operations.md](admin/operations.md) |
| Pusher notifications | [user/notifications.md](user/notifications.md) · [developer/pusher-events.md](developer/pusher-events.md) |
| Captain repost / history | [user/commands.md](user/commands.md#captain-commands) · `seven pusher history` |

## Recent changes (2026-06-14)

| Area | Summary |
|------|---------|
| **OAuth** | Access + refresh tokens; auto-refresh; `HTB_TOKEN_FILE` + `.env` sync; `seven htb token set` / `status` / `refresh`; captain DM on auth failure |
| **Pusher** | `NotificationRouter` — queue, filters, `@mentions`, fallback poll, reconnect catch-up, channel resubscribe |
| **Fallback API** | `getRecentTeamActivityForFallback()` via `team/activity`; poll always active |
| **Persistence** | `seven_notification_events` table; captain `pusher history` / `pusher repost` |
| **Dev** | `PUSHER_MSG_LOG.json` under `LOG_DIR`; `npm run test:pusher` |
| **API** | `isOptionalMemberProfilePath()` — tolerate 404 on optional member endpoints |
| Link Discord to HTB | [user/privacy.md](user/privacy.md) |
| Smoke tests | [developer/testing.md](developer/testing.md) |
