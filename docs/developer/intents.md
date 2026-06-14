# Intent Reference

Dialogflow intents map to handlers in the `switch` block of `bot.js`. Parameters come from Dialogflow as `P.*`.

## User intents

| Intent | Handler | Output |
|--------|---------|--------|
| `help` | `sendHelpMessages()` | Paginated manual from `static/strings.js` |
| `getTeamInfo` | `EGI.teamInfo()` | Team embed |
| `getTeamRanking` | `EGI.teamRank()` | Global rank embed |
| `getTeamLeaders` | `EGI.teamLeaderboard()` | Leaderboard embed |
| `getTeamLeader` | `sendTeamLeaderMsg()` | #1 member spotlight |
| `getTeamBadge` | URL + fulfillment text | Team badge image link |
| `getFlagboard` | `sendFlagboardMsg()` | Country flags embed |
| `getTargetInfo` | `EGI.infoFor()` | Machine/challenge/special info |
| `getTargetOwners` | `EGI.teamOwnsForTarget()` | Who owned/solved target |
| `checkMemberOwnedTarget` | `EGI.checkMemberOwnedTarget()` | Member × target ownership check |
| `getMemberInfo` | `EGI.memberInfo()` | Member profile embed |
| `getMemberRank` | `EGI.memberRank()` | Member rank embed |
| `getMemberChart` | `sendMemberChartMsg()` | Achievement chart (Puppeteer) |
| `filterMemberOwns` | `sendActivityMsg()` | Activity timeline + chart |
| `filterTargets` | `EGI.filteredTargets()` | Filtered target list |
| `filterMembers` | `EGI.filteredTargets()` | Filtered member rankings |
| `getNewBox` | `EGI.infoFor(machine, newBoxId)` | Latest unreleased machine |
| `getFirstBox` | `EGI.infoFor("machine", "Lame")` | Easter egg |
| `getTime` | `EGI.binClock()` | Binary clock image |
| `linkDiscord` | `linkDiscord()` | Link Discord ↔ HTB |
| `forgetMe.htbIgnore.getUserID` | `forgetHtbDataFlow("htb")` | Blacklist HTB account |
| `forgetMe.discordUnlink.getUserID` | `forgetHtbDataFlow("discord")` | Unlink Discord |
| `forgetMe.all.getUserID` | `forgetHtbDataFlow("all")` | Both |
| `unforgetMe` | `unignoreMember()` | Re-allow blacklisted member |
| `Default Fallback Intent` | Small talk + `resolveEnt` fallback | Dialogflow fallback or entity card |

## Admin / captain intents

| Intent | Guard | Handler |
|--------|-------|---------|
| `admin.forceUpdateData` | Captain or admin | `forceUpdate()` → `refresh({ force: true })` |
| `admin.clearCached` | Admin | `admin_clearCached()` → `refresh({ full: true })` |
| `admin.setHtbTokens` | Admin | `admin_setHtbTokens()` — hot-reload OAuth pair + persistence |
| `admin.pusherStatus` | Admin | `NOTIFICATION_ROUTER.getStatusEmbed()` |
| `captain.pusherHistory` | Captain | `NOTIFICATION_ROUTER.getHistoryEmbed()` → `EGI.pusherHistory()` |
| `captain.pusherRepost` | Captain | `NOTIFICATION_ROUTER.repostToChannel()` → `handleOwnEvent({ forceRepost: true })` |
| `admin.setStatus` | Admin | `admin_setStatus()` |
| `admin.setupEmoji` | — | `E.initCustEmoji()` |
| `admin.clearEmoji` | — | `E.clearCustEmoji()` |
| `admin.passthruOn` | Admin | `SEND.passthruOn()` |
| `admin.passthruOff` | Admin | `SEND.passthruOff()` |

## Fun / agent intents

| Intent | Handler |
|--------|---------|
| `agent.doReboot` | `doFakeReboot()` — cosmetic Discord status |
| `agent.getPickled` | `SEND.pickleOn()` — scrambled replies |
| `agent.getUnpickled` | `SEND.pickleOff()` |

## Entity resolution (outside switch)

When Dialogflow doesn't match an intent, `resolveEnt()` tries to match the message text to a cached HTB entity (machine, challenge, member, etc.) and returns an info card.

Local NLP overrides in `helpers/nlp.js` (`resolveLocalIntent()`) can correct or pre-resolve intents before the switch runs.

Captain/admin Pusher commands (no Dialogflow intent required):

| Phrase | Local intent |
|--------|--------------|
| `pusher status` | `admin.pusherStatus` |
| `set htb tokens <access> <refresh>` | `admin.setHtbTokens` |
| `pusher history` / `pusher history <member>` | `captain.pusherHistory` |
| `pusher repost last` / `pusher repost <id>` | `captain.pusherRepost` |

## Common parameters

| Parameter | Used by | Description |
|-----------|---------|-------------|
| `P.username` | Member intents | HTB username or "me" |
| `P.target` / `P.targetname` | Target intents | Machine/challenge name |
| `P.htbTargetType` / `P.targettype` | Target intents | Entity type hint |
| `P.ownType` / `P.ownFilter` | Ownership intents | user/root, first/last |
| `P.interval` | Chart intents | Time range (normalized by `normalizeChartTerm()`) |
| `P.uid` | Link/forget intents | HTB user ID |

## Adding a new intent

1. Create Dialogflow intent with training phrases and parameters
2. Add `case "your.intent":` in `bot.js`
3. Implement embed in `views/embeds.js`
4. Add help section in `static/strings.js`
5. Add smoke test case if parsing is non-trivial

See [CONTRIBUTING.md](../../CONTRIBUTING.md) and `.cursor/skills/seven-discord-feature/SKILL.md`.

## Related

- [User commands](../user/commands.md)
- [Dialogflow & NLP](dialogflow.md)
- [Testing](testing.md)
