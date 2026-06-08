# Achievement Notifications

Seven can post real-time HTB achievement announcements to a configured Discord channel when team members root boxes, solve challenges, or earn first blood.

## How it works

Seven subscribes to HTB's public Pusher feed (`helpers/pusher-htb.js`). When an event concerns a member of your team, Seven posts a formatted embed to the **announce channel** configured by your admin (`DISCORD_ANNOUNCE_CHAN_ID`).

## Event types

| Event | Description |
|-------|-------------|
| **Own** | A team member roots a machine or solves a challenge |
| **First blood** | A team member gets first blood on a target |
| **Machine launch** | A new machine goes live ("mass-powering") |

## Discord mentions

If a team member has **linked their Discord account to HTB** (see [privacy.md](privacy.md)), Seven can @mention them in announce messages. Without a link, the announcement still appears but without a Discord ping.

## What you need to do

1. **Link your account** — `I am <uid> on HTB` or `My HTB username is <name>`
2. **Stay in the team** — notifications only fire for current team members in Seven's cache
3. **Watch the announce channel** — your admin configures which channel receives posts

## What notifications don't include

- Private or non-team activity
- Blacklisted members (those who used "forget me" for HTB blacklist)
- Events while the bot is offline or syncing

## Troubleshooting (users)

| Issue | Likely cause |
|-------|--------------|
| No pings when I root | Discord not linked to HTB |
| No announce channel activity | Bot offline, wrong channel config, or not a team member |
| Wrong person pinged | Stale Discord link — unlink and re-link |

For server-side issues (Pusher disconnect, token expiry), contact your admin or see [admin/troubleshooting.md](../admin/troubleshooting.md).

## Related

- [Privacy & linking](privacy.md)
- [User guide](README.md)
