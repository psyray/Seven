# User Guide

Seven is a Discord bot that makes Hack The Box achievement data accessible in your team channel. Ask questions in natural language — no rigid command syntax required.

## How to talk to Seven

| Context | How to invoke |
|---------|---------------|
| **Server channel** | Prefix with `seven` — e.g. `seven help`, `seven team info` |
| **Direct message (DM)** | No prefix — just `help`, `team info`, etc. |
| **Quick lookup** | Type an HTB name directly (machine, challenge, member) for an info card |

Seven uses AI (DialogFlow) and understands many phrasings. If a query fails, reword it or try the examples in [commands.md](commands.md).

## Built-in help

Type any of these for the full in-bot manual:

- `seven help`
- `seven man seven`
- `seven what can you do`

Captains and admins see extra sections for maintenance commands.

## What Seven can do

- **HTB targets** — machines, challenges, fortresses, endgames, pro labs
- **Ownership** — who rooted/solved what, member activity timelines
- **Members** — profiles, ranks, achievement charts
- **Team** — info, global rank, leaderboard, flagboard, badge
- **Filters** — hardest/easiest boxes, OS filters, incomplete lists per member
- **Privacy** — link Discord to HTB, opt out of tracking
- **Fun** — binary clock, small talk, easter eggs

## Tips

- Names are case-insensitive; typos often still work.
- Link your HTB account to use `me` / `my rank` and get Discord pings on achievements.
- Achievements posted in the announce channel require a linked account — see [privacy.md](privacy.md).
- Re-ask with simpler wording if DialogFlow mishears you.

## Further reading

- [Commands reference](commands.md)
- [Privacy & linking](privacy.md)
- [Example queries](examples.md)
- [Achievement notifications](notifications.md)
