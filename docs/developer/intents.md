# Intent Reference

Dialogflow intents map to handlers in the `switch` block of `bot.js`. Parameters come from Dialogflow as `P.*`.

## User intents

| Intent | Handler | Output |
|--------|---------|--------|
| `help` | `sendHelpMessages()` | Paginated manual from `static/strings.js` |
| `getTeamInfo` | `EGI.teamInfo()` | Team embed |
| `getTeamRanking` | `EGI.teamRank()` | Global rank embed |
| `getTeamActivity` | `sendTeamActivityMsg()` | Live team owns from HTB `team/activity` (default 7 days) |
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
| `filterTargets` | `EGI.filteredTargets()` | Filtered target list (machines, challenges, fortresses, endgames, pro labs) |
| `filterMembers` | `EGI.filteredTargets()` | Filtered member rankings |
| `getNewBox` | `EGI.infoFor(machine, newBoxId)` | Latest unreleased machine |
| `getFirstBox` | `EGI.infoFor("machine", "Lame")` | Easter egg |
| `getTime` | `EGI.binClock()` | Binary clock image |
| `linkDiscord` | `linkDiscord()` | Link Discord ↔ HTB |
| `forgetMe.htbIgnore.getUserID` | `forgetHtbDataFlow("htb")` | Blacklist HTB account |
| `forgetMe.discordUnlink.getUserID` | `forgetHtbDataFlow("discord")` | Unlink Discord |
| `forgetMe.all.getUserID` | `forgetHtbDataFlow("all")` | Both |
| `unforgetMe` | `unignoreMember()` | Re-allow blacklisted member |
| `Default Fallback Intent` | Small talk + `resolveEntWithEnsure` fallback | DialogFlow fallback or entity card (on-demand HTB fetch) |

## Admin / captain intents

| Intent | Guard | Handler |
|--------|-------|---------|
| `admin.forceUpdateData` | Captain or admin | `forceUpdate()` → `refresh({ force: true })` |
| `admin.syncSection` | Captain or admin | `admin_syncSection()` → `refresh({ sections: [...] })` |
| `admin.clearCached` | Admin | `admin_clearCached()` → `refresh({ full: true, bootstrap: true })` |
| `admin.htbTokenSet` | Admin | `admin_htbTokenSet()` — refresh-only or full pair + persistence |
| `admin.htbTokenStatus` | Admin | `admin_htbTokenStatus()` → `EGI.htbTokenStatus()` |
| `admin.pusherStatus` | Admin | `NOTIFICATION_ROUTER.getStatusEmbed()` |
| `captain.pusherHistory` | Captain | `NOTIFICATION_ROUTER.getHistoryEmbed()` → `EGI.pusherHistory()` |
| `captain.pusherRepost` | Captain | `NOTIFICATION_ROUTER.repostToChannel()` → `handleOwnEvent({ forceRepost: true })` |
| `captain.teamActivitySync` | Captain | Silent sync, `publish` (N recent), or `publish-all` — see modes below |
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

When Dialogflow doesn't match an intent, `resolveEntWithEnsure()` tries cache first, then fetches a single target from HTB if needed.

Local NLP overrides in `helpers/nlp.js` (`resolveLocalIntent()`) can correct or pre-resolve intents before the switch runs.

Captain/admin commands (no Dialogflow intent required):

| Phrase | Local intent |
|--------|--------------|
| `pusher status` | `admin.pusherStatus` |
| `htb token status` / `token status` | `admin.htbTokenStatus` |
| `htb token set <refresh>` | `admin.htbTokenSet` (mode `refresh`) |
| `htb token refresh` | `admin.htbTokenRefresh` (stored refresh) |
| `htb token set <access> <refresh>` | `admin.htbTokenSet` (mode `pair`) |
| `set htb tokens <access> <refresh>` | `admin.htbTokenSet` (legacy alias, pair only) |
| `sync machines` / `sync fortresses` / `sync all` / … | `admin.syncSection` |
| `list prolabs` / `list pro labs` / `list fortresses` / `list endgames` / `list all …` | `filterTargets` (catalog list; pro labs = all entries, id asc, mini/standard labels) |
| `pusher history` / `pusher history <member>` | `captain.pusherHistory` |
| `pusher repost last` / `pusher repost <id>` | `captain.pusherRepost` |
| `team activity sync` / `team activity sync 30` | `captain.teamActivitySync` (mode `silent`) |
| `team activity sync publish` / `team activity sync publish 10` | `captain.teamActivitySync` (mode `publish`) |
| `team activity sync publish-all` / `team activity sync publish-all 30` | `captain.teamActivitySync` (mode `publishAll`) |
| `team info` / `clk` / `who are we` / `team rank` / `team leaders` / `flagboard` / `team badge` / `team activity` | Team intents (see user intents table) |
| `reboot` / `what time is it?` / `first box` / `clear cache` / `force update` | Fun/admin local overrides |

## Common parameters

| Parameter | Used by | Description |
|-----------|---------|-------------|
| `P.username` | Member intents | HTB username or "me" |
| `P.target` / `P.targetname` | Target intents | Machine/challenge name |
| `P.htbTargetType` / `P.targettype` | Target intents | Entity type hint |
| `P.ownType` / `P.ownFilter` | Ownership intents | user/root, first/last |
| `P.interval` | Chart intents | Time range (normalized by `normalizeChartTerm()`) |
| `P.limit` / `P.targetFilterBasis` | `filterTargets` | Result cap; `{ cust: "nolimit" }` shows full catalog (used for `list prolabs`) |
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
