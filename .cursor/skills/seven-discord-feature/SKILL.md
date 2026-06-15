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
    → resolveEntWithEnsure() OR understand() [DialogFlow]
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

Messages matching HTB entity names bypass DialogFlow via `DAT.resolveEntWithEnsure(message.content, …, lookup=true)`. Unknown names trigger `ensureCachedTarget()` (single HTB fetch) before replying. Resolver logic lives in `SevenDatastore` + `helpers/htb-sync-engine.js`.

## Help text

Captain/admin sync commands are documented in `static/strings.js` (`sectionCaptain`, `sectionAdmin`) and mirrored in `docs/user/commands.md`. Update both when adding sync commands.

## Catalog lists (`filterTargets`)

Local NLP in `helpers/nlp.js` handles `list fortresses`, `list endgames`, `list prolabs`:

| Type | Limit | Sort | Display |
|------|-------|------|---------|
| `prolab` | All (`nolimit`) | `id` asc | `standard` / `mini` suffix per HTB `mini` flag |
| `fortress` / `endgame` | 15 (or all with `list all …`) | `id` asc | Orange guild emoji + name link |

`SevenDatastore.filterEnt()` uses **ascending id** as default sort for fortress/endgame/prolab when `sortorder` is empty (avoids surfacing newest mini labs first).

`filteredTargets()` skips the `limit === 0` joke error when `targetFilterBasis` contains `{ cust: "nolimit" }`.

Dialogflow may still supply `targetFilterBasis` (e.g. `blang: "Active Directory"`) for the embed subtitle; local NLP merges DF basis when present for pro lab lists.

## Admin features

| Intent | Function | Sync mode |
|--------|----------|-----------|
| `admin.forceUpdateData` | `forceUpdate()` | `{ force: true }` |
| `admin.syncSection` | `admin_syncSection()` | `{ sections: [...] }` — `seven sync machines` etc. |
| `admin.clearCached` | `admin_clearCached()` | `{ full: true, bootstrap: true }` |
| `admin.setHtbTokens` | `admin_setHtbTokens()` | local NLP: `set htb tokens …` |
| `admin.pusherStatus` | `NOTIFICATION_ROUTER.getStatusEmbed()` | — |
| `captain.pusherHistory` | `NOTIFICATION_ROUTER.getHistoryEmbed()` | — |
| `captain.pusherRepost` | `NOTIFICATION_ROUTER.repostToChannel()` | `forceRepost` skips dedup + stat integration |

## Pusher real-time notifications

```
HTB Pusher → parsePusherEvent [pusher-htb.js]
  → NotificationRouter.handlePusherEvent [notification-router.js]
    → ensureCachedTarget if target missing from cache
    → recordEvent → NotificationStore.append [notification-store.js → seven_notification_events]
    → HtbEmbeds.pusherOwn / pusherNotif / pusherTeamNotification
    → DISCORD_ANNOUNCE_CHAN (with allowedMentions for linked users)
    → integratePusherOwn/Blood + debounced updateCache (skipped on forceRepost)
```

When extending notification types:

1. Parse in `helpers/pusher-htb.js` (`parsePusherEvent`)
2. Route in `helpers/notification-router.js` (`OWN_TYPES`, config filters)
3. Embed in `views/embeds.js` (`pusherOwn`, `pusherTeamNotification`, `pusherHistory`)
4. Cache in `SevenDatastore.integratePusherOwn()` if query commands need live data
5. Sample HTML in `cache/PUSHER_SAMPLE_EVENTS.json` + `npm run test:pusher`

Captain recovery (local NLP in `helpers/nlp.js`):

- `seven pusher history [member]` → `getHistoryEmbed()`
- `seven pusher repost last|<id>` → `repostToChannel()` → `handleOwnEvent({ forceRepost: true })`
- Guard with `isCaptain()` only (not admin unless also captain)

Mentions: `DAT.getDiscordMention(uid)` + `allowedMentions: { users: [id] }` — not `tryDiscordifyUid` alone.

Config: `PUSHER_*` vars via `helpers/pusher-config.js` (see `static/templates/.env.docker.example`).

## Testing

1. Start bot with populated cache (`docker:logs` shows member/machine counts > 0)
2. Test in Discord: `seven team info`, `seven <machinename>`, `seven <username> rank`
3. Test empty cache: clear → verify graceful embeds, not crashes
4. Pusher parser: `npm run test:pusher`
5. Admin status: `seven pusher status`
6. Captain history/repost: `seven pusher history`, `seven pusher repost last` (after an event is stored)

## Key files

- `bot.js` — intent switch, admin/captain guards, wires `NotificationRouter` + `NotificationStore`
- `views/embeds.js` — all embed builders (`pusherOwn`, `pusherStatus`, `pusherHistory`, …)
- `modules/send.js` — delivery, typing simulation
- `helpers/emoji.js` — custom HTB emoji
- `helpers/pusher-htb.js` — Pusher client + HTML parser
- `helpers/notification-router.js` — announce routing, queue, fallback, repost
- `helpers/notification-store.js` — Postgres event log
- `helpers/pusher-config.js` — `PUSHER_*` env config
- `helpers/htb-sync-engine.js` — delta catalog sync + on-demand ensure
- `helpers/nlp.js` — local intent overrides (`list prolabs`, sync, pusher, …)
- `static/strings.js` — help text (`buildHelpMessages`), canned responses
