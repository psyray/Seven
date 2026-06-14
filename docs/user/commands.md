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
- Ask for info on any cached special target by name.

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

- `force update` / `refresh team data` — smart sync after roster changes

### HTB OAuth (when sync fails)

- Seven uses OAuth access + refresh tokens (~72h cycle); access renews automatically.
- If refresh fails, **captains receive a DM** with fix instructions.
- Re-login on [labs.hackthebox.com](https://labs.hackthebox.com) → DevTools → Network → `login/refresh` → update tokens (see Admin).
- The bot stays online with cached data until tokens are fixed.

---

## Admin commands

Available to admins only:

- `set htb tokens <access_jwt> <refresh>` — hot-reload OAuth pair without restart
- `clear cache` — wipe memory + full HTB refresh
- `set status …` — Discord status/activity
- `setup emoji` / `clear emoji` — HTB custom emoji on guild
- `parrot on` / `parrot off` — mirror channel messages to admin DM (debug)

Token pair: capture `message.access_token` + `message.refresh_token` from the browser `login/refresh` response. Optional Docker persistence: `HTB_TOKEN_FILE` JSON (updated after each refresh).

See [admin/operations.md](../admin/operations.md) for what these do under the hood.

---

## Feedback

Bugs or ideas? Open an issue on [GitHub](https://github.com/psyray/Seven/issues).
