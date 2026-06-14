# Achievement Notifications

Seven can post real-time HTB achievement announcements to a configured Discord channel when team members root boxes, solve challenges, capture lab flags, or earn first blood.

## How it works

Seven subscribes to HTB's public Pusher feed (`helpers/pusher-htb.js`) and routes events through `helpers/notification-router.js`. When an event concerns a member of your team (or a global first blood), Seven posts a formatted embed to the **announce channel** configured by your admin (`DISCORD_ANNOUNCE_CHAN_ID`).

If Pusher disconnects, Seven falls back to polling `team/activity` from the HTB API.

## Event types

| Event | Description |
|-------|-------------|
| **Machine own** | User or root flag on a box |
| **Challenge solve** | Challenge completed |
| **Lab flag** | Endgame, Fortress, or Pro Lab flag captured |
| **Starting Point** | Starting Point box owned |
| **First blood** | First blood on a machine or challenge (any user) |
| **Machine launch** | A new machine goes live ("mass-powering") |
| **Badge / rank** | Optional team-member badge or rank notifications |

## Discord mentions

If a team member has **linked their Discord account to HTB** (see [privacy.md](privacy.md)), Seven **@mentions** them in own announcements when `PUSHER_MENTION_ON_OWN=true` (default). Without a link, the announcement still appears using the HTB username only.

## What you need to do

1. **Link your account** — `I am <uid> on HTB` or `My HTB username is <name>`
2. **Stay in the team** — notifications fire for current team members in Seven's cache, plus global first blood events
3. **Watch the announce channel** — your admin configures which channel receives posts

## What notifications don't include

- Private or non-team activity (except first blood)
- Blacklisted members (those who used "forget me" for HTB blacklist)
- Shoutbox messages (disabled by default)
- Events missed while the bot is fully offline (partial catch-up on reconnect via API fallback)

## Troubleshooting (users)

| Issue | Likely cause |
|-------|--------------|
| No pings when I root | Discord not linked to HTB, or `PUSHER_MENTION_ON_OWN=false` |
| No announce channel activity | Bot offline, wrong channel config, or not a team member |
| Wrong person pinged | Stale Discord link — unlink and re-link |
| Lab owns missing | Rare HTML format change — admin can check `seven pusher status` |

For server-side issues (Pusher disconnect, token expiry), contact your admin or see [admin/operations.md](../admin/operations.md).

## Related

- [Privacy & linking](privacy.md)
- [User guide](README.md)
- [Pusher event formats (developers)](../developer/pusher-events.md)
