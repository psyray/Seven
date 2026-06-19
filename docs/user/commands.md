# Commands Reference

This page mirrors the in-bot manual from `static/strings.js`. Type `seven help` in Discord for the live version.

Placeholders: `_boxname_`, `_challengename_`, `_username_` — replace with real HTB names.

---

## Getting started

### How to talk to Seven

- In server channels, prefix with `seven` (e.g. `seven help`, `seven team info`).
- In DMs, no prefix needed — just `help`, `team info`, etc.
- Type an HTB name directly for a quick info card (machine, challenge, member…).

### Quick triggers

- `help` / `man seven` / `what can you do`
- `what's new` — latest unreleased machine
- Just type a box or member name

---

## HTB targets

### Machines (active & retired)

- `_boxname_` or `_boxname_ info`
- `When did _boxname_ go live / retire?`
- `How hard is _boxname_?`

### Challenges

- `_challengename_` / `_challengename_ info`

### Special content

- Fortress, Endgame, Pro Lab names work the same way.
- Seven fetches missing targets from HTB on demand if not in cache.
- Pro Labs include full scenarios (e.g. RastaLabs, Offshore) and shorter **mini** labs (e.g. FullHouse, Trusted).

### Newest content

- `What's new?` / `What's fresh?` — latest machine
- `First box` — classic Lame easter egg

---

## Ownership

### Who owned a target (team)

- `Who did _boxname_?`
- `Who rooted _boxname_?`
- `Who rooted _boxname_ last / first?`
- `Who solved _challengename_?`

### Did a member own something?

- `Has _username_ rooted _boxname_?`
- `Did _username_ solve _challengename_?`
- Works for user/root flags and challenge solves.

### Member activity timeline

- `What boxes has _username_ owned?`
- `What challenges did _username_ do?`
- `Show _username_ activity` — chart + recent owns

---

## Members

### Profile & stats

- `_username_ info` / `who is _username_`
- `What rank am I?` / `_username_ rank`
- `How many boxes has _username_ owned?`
- `When did _username_ join HTB?`

### Charts

- `_username_ chart` — achievement timeline (default 1 year)
- `_username_ progress over 6 months` (interval varies: `6 months`, `1Y`, etc.)

### Self references

- `me`, `my rank`, `my stats` — requires linking Discord to HTB first (see [privacy.md](privacy.md)).

---

## Team

### Team overview

- `team info` / team name / `who are we`
- `team rank` / `how are we doing` — global ranking

### Leaderboard

- `team leaders` / `leaderboard` — top members
- `who's on top` / `team leader` — #1 spotlight

### Extras

- `flagboard` — member country flags
- `team badge` — badge image URL
- `Who started the team?` / `team founder`

For university deployments, replace "team" with "university" where applicable.

---

## Filters & lists

### Filter targets (machines, challenges…)

- `hardest machines` / `easiest challenges`
- `newest / oldest boxes`
- `best rated` / `worst rated` machines
- `active boxes` / `retired boxes`
- `linux boxes` / `windows boxes`
- `incomplete challenges for _username_`
- `boxes _username_ hasn't finished`

### Catalog lists (fortresses, endgames, pro labs)

- `list fortresses` / `list endgames` — first 15 entries, sorted by HTB id (ascending)
- `list prolabs` / `list pro labs` — **all** pro labs in cache, sorted by id (ascending)
- Each pro lab line is tagged **standard** (full scenario) or **mini** (short lab), from HTB `mini` flag
- `list all machines` (and similar `list all …`) — no result cap

### Filter members

- `who has the most roots?` / member rankings

### Sort hints

Supported sort/filter keywords include: hardest, easiest, newest, oldest, best/worst rated, active, inactive, complete, incomplete per member.

---

## Privacy & linking

See [privacy.md](privacy.md) for full details.

- Link: `I am _uid_ on HTB` or `My HTB username is _uname_`
- Forget me: unlink Discord, blacklist HTB account, or both
- Undo: `remember me again` / `unforget me`

---

## Seven & fun

- **Binary clock** — `what time is it?`
- **Small talk** — ask about Seven, hobbies, life…
- **Fake reboot** — `reboot` (cosmetic Discord status change)
- **Pickle mode** — scrambled replies easter egg

---

## Captain commands

Available to captains and admins:

- `force update` / `refresh team data` — delta catalog sync (incl. stale) + full team member refresh
- `sync machines` / `sync challenges` / `sync fortresses` / `sync endgames` / `sync prolabs` / `sync specials` / `sync all` — delta sync for one section only

### HTB OAuth (when sync fails)

- Seven uses OAuth access + refresh tokens (~72h cycle); access renews automatically.
- If refresh fails, **captains receive a DM** with fix instructions.
- Re-login on [labs.hackthebox.com](https://labs.hackthebox.com) → DevTools → Network → `login/refresh` → capture a **fresh** token pair (see Admin).
- HTB invalidates each refresh token after use — never reuse an old paste.
- The bot stays online with cached data until tokens are fixed.

### Notification history & repost (captain only)

Not available to admins unless they are also in `CAPTAIN_DISCORD_IDS`:

- `pusher history` — persisted HTB notification events (Pusher + fallback)
- `pusher history <member>` — filter by HTB username
- `pusher repost last` — repost the latest stored own/flag to the announce channel
- `pusher repost <id>` — repost a specific event (id from history embed)
- Missing targets are fetched from HTB automatically before repost when possible

See [notifications.md](notifications.md) for details.

---

## Admin commands

Available to admins only (use **DM** for token commands — refresh tokens are long):

- `htb token status` — OAuth access expiry, refresh token presence, persistence paths
- `htb token set <refresh>` — store refresh token and renew access via HTB OAuth refresh (paste the full token once; ~700+ characters)
- `htb token refresh` — renew access using the refresh token already in memory
- `htb token set <access_jwt> <refresh>` — hot-reload full OAuth pair without restart (recommended; one line or two lines)
- Legacy alias: `set htb tokens <access_jwt> <refresh>` (pair only)
- `pusher status` — Pusher connection, announce queue, recent events
- `clear cache` — wipe memory + delta bootstrap from HTB API
- `set status …` — Discord status/activity
- `setup emoji` / `clear emoji` — HTB custom emoji on guild
- `parrot on` / `parrot off` — mirror channel messages to admin DM (debug)

**Token capture:** DevTools → Network → `login/refresh` on [labs.hackthebox.com](https://labs.hackthebox.com) → copy `message.access_token` + `message.refresh_token` from the **same** response. HTB rotates the refresh token on every use — capture a new pair after browser login; do not reuse a token you already pasted elsewhere.

**Docker persistence:** after each successful refresh, Seven updates `HTB_TOKEN_FILE` (volume `seven_logs`) and syncs `HTB_V4_TOKEN` / `HTB_REFRESH_TOKEN` into `config/docker/seven.env` on the host (`npm run docker:prepare` seeds this file from `.env` on first `docker:up`).

See [admin/operations.md](../admin/operations.md) for what these do under the hood.

---

## Feedback

Bugs or ideas? Open an issue on [GitHub](https://github.com/psyray/Seven/issues).
