---
name: seven-discord-feature
description: >-
  Add or fix Discord bot features: DialogFlow intents, embed builders, entity
  resolution, admin commands, Pusher notifications. Use when implementing new
  bot commands, fixing embed errors, or extending HtbEmbeds/Send modules.
---

# Seven Discord Feature

## Feature workflow

```
User message
  → handleMessage() [bot.js]
    → resolveEnt() OR understand() [DialogFlow]
      → bot.js switch case
        → HtbEmbeds.method() [views/embeds.js]
          → Send.embed() / Send.human() [modules/send.js]
```

## Adding a new command

### 1. DialogFlow intent (if NLP-based)

- Intent name becomes `case` in `bot.js` (e.g. `getTeamInfo`)
- Entity types synced via `helpers/dflow.js`

### 2. Handler in bot.js

```javascript
case "myNewIntent":
  SEND.embed(message, EGI.myNewEmbed(P.paramName))
  break
```

### 3. Embed in views/embeds.js

```javascript
myNewEmbed(param) {
  const target = this.ds.resolveEnt(param, "machine")
  if (!target?.name) {
    return this.ENTITY_UNFOUND
      .setDescription(`Could not find '${param}'.`)
  }
  return this.TARGET_INFO_BASE
    .setTitle(target.name)
    .setDescription("…")  // REQUIRED
}
```

### 4. Entity sync (if new DialogFlow entity)

Add to `dflow.js` sync lists. For special flags, use `extractSpecialTargetFlagNames()` pattern.

## Fixing embed 400 errors

```
DiscordAPIError: embed.description: This field is required
```

→ Every code path returning a `MessageEmbed` must call `.setDescription()`. Check `teamInfo()`, `memberRank()`, `teamRank()` for empty-cache branches.

## Fixing resolveEnt crashes

```
TypeError: Cannot convert undefined or null to object at Object.values
```

→ Guard before `Object.values()`:

```javascript
const fortresses = this.MISC?.FORTRESSES || {}
Object.values(fortresses)
```

## Direct entity queries

Messages matching HTB entity names bypass DialogFlow via `DAT.resolveEnt(message.content, ...)`. New entity types need resolver logic in `SevenDatastore.resolveEnt()`.

## Admin features

| Intent | Function | Sync mode |
|--------|----------|-----------|
| `admin.forceUpdateData` | `forceUpdate()` | `{ force: true }` |
| `admin.clearCached` | `admin_clearCached()` | `{ full: true }` |
| `admin.pusherStatus` | `NOTIFICATION_ROUTER.getStatusEmbed()` | — |

## Pusher real-time notifications

```
HTB Pusher → parsePusherEvent [pusher-htb.js]
  → NotificationRouter.handlePusherEvent [notification-router.js]
    → HtbEmbeds.pusherOwn / pusherNotif / pusherTeamNotification
    → DISCORD_ANNOUNCE_CHAN (with allowedMentions for linked users)
    → integratePusherOwn/Blood + debounced updateCache
```

When extending notification types:

1. Parse in `helpers/pusher-htb.js` (`parsePusherEvent`)
2. Route in `helpers/notification-router.js` (`OWN_TYPES`, config filters)
3. Embed in `views/embeds.js` (`pusherOwn`, `pusherTeamNotification`)
4. Cache in `SevenDatastore.integratePusherOwn()` if query commands need live data
5. Sample HTML in `cache/PUSHER_SAMPLE_EVENTS.json` + `npm run test:pusher`

Mentions: `DAT.getDiscordMention(uid)` + `allowedMentions: { users: [id] }` — not `tryDiscordifyUid` alone.

Config: `PUSHER_*` vars via `helpers/pusher-config.js` (see `static/templates/.env.docker.example`).

## Testing

1. Start bot with populated cache (`docker:logs` shows member/machine counts > 0)
2. Test in Discord: `seven team info`, `seven <machinename>`, `seven <username> rank`
3. Test empty cache: clear → verify graceful embeds, not crashes
4. Pusher parser: `npm run test:pusher`
5. Admin status: `seven pusher status`

## Key files

- `bot.js` — intent switch, admin guards (`isAdmin`, `isCaptain`), wires `NotificationRouter`
- `views/embeds.js` — all embed builders (`pusherOwn`, `pusherStatus`, …)
- `modules/send.js` — delivery, typing simulation
- `helpers/emoji.js` — custom HTB emoji
- `helpers/pusher-htb.js` — Pusher client + HTML parser
- `helpers/notification-router.js` — announce routing, queue, fallback
- `helpers/pusher-config.js` — `PUSHER_*` env config
- `static/strings.js` — help text, canned responses
