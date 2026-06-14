# HTB Pusher event formats

Seven subscribes to HTB public Pusher channels (`helpers/pusher-htb.js`) and parses HTML payloads into structured `HtbPusherEvent` objects.

Collect live samples with `IS_DEV_INSTANCE=true` — events append to `LOG_DIR/PUSHER_MSG_LOG.json` (Docker: `/var/log/sevenbot/PUSHER_MSG_LOG.json`) or `./cache/PUSHER_MSG_LOG.json` locally.

## Channels

| Channel | Event | Purpose |
|---------|-------|---------|
| `owns-channel` | `display-info` | Machine/challenge/lab owns, first blood |
| `infobox-channel` | `display-info` | Machine launches (`mass-powering`), retirements |
| `notifications-channel` | `display-notifications` | Badges, respects, rank milestones |
| `joins-channel` | `display-info` | New HTB account registrations |
| `shoutbox-channel` | `display-shout` | Global shoutbox (opt-in only) |

Auth: `POST ${HTB_APP_BASE}/pusher/auth` with Bearer `HTB_V4_TOKEN`.

## Parsed fields

| Field | Type | Description |
|-------|------|-------------|
| `uid` | number | HTB user id from first profile link |
| `type` | string | `machine`, `challenge`, `endgame`, `fortress`, `prolab`, `starting_point`, `launch`, `badge`, `respect`, `rank_up`, `join`, `notification` |
| `target` | string | Entity name (machine, challenge, lab, …) |
| `flag` | string | `user`, `root`, `challenge`, or flag title for labs |
| `blood` | boolean | First blood marker (`span.text-danger` + `1st blood`) |
| `markdown` | string | Turndown conversion of HTML (debug / fallback embed) |

## Sample HTML (owns-channel)

### Machine user own

```html
<a href="https://app.hackthebox.com/users/12345">Alice</a> owned user on <a href="https://app.hackthebox.com/machines/456">Lame</a>
```

Expected: `{ uid: 12345, type: "machine", target: "Lame", flag: "user", blood: false }`

### Machine root own + first blood

```html
<a href="https://app.hackthebox.com/users/12345">Alice</a> owned <span class="text-danger">1st blood</span> root on <a href="https://app.hackthebox.com/machines/456">Lame</a>
```

Expected: `{ uid: 12345, type: "machine", target: "Lame", flag: "root", blood: true }`

### Challenge solve

```html
<a href="https://app.hackthebox.com/users/12345">Alice</a> solved <a href="https://app.hackthebox.com/challenge/789">Emission</a>
```

Expected: `{ uid: 12345, type: "challenge", target: "Emission", flag: "challenge", blood: false }`

### Fortress flag

```html
<a href="https://app.hackthebox.com/users/12345">Alice</a> got flag <strong>Entry Point</strong> on <a href="https://app.hackthebox.com/fortress/12">Akerva</a>
```

Expected: `{ uid: 12345, type: "fortress", target: "Akerva", flag: "Entry Point", blood: false }`

### Endgame flag

```html
<a href="https://app.hackthebox.com/users/12345">Alice</a> captured flag <strong>Flag 1</strong> on <a href="https://app.hackthebox.com/endgame/3">P.O.O.</a>
```

Expected: `{ uid: 12345, type: "endgame", target: "P.O.O.", flag: "Flag 1", blood: false }`

### Pro Lab milestone

```html
<a href="https://app.hackthebox.com/users/12345">Alice</a> got flag <strong>DEV</strong> on <a href="https://app.hackthebox.com/prolabs/5">Offshore</a>
```

Expected: `{ uid: 12345, type: "prolab", target: "Offshore", flag: "DEV", blood: false }`

### Starting Point

```html
<a href="https://app.hackthebox.com/users/12345">Alice</a> owned user on <a href="https://app.hackthebox.com/starting-point/1">Meow</a>
```

Expected: `{ uid: 12345, type: "starting_point", target: "Meow", flag: "user", blood: false }`

### Machine launch (infobox-channel)

```html
<span data="Lame">mass-powering</span> a new machine is going live
```

Expected: `{ type: "launch", target: "Lame" }`

## Sample HTML (notifications-channel)

### Badge

```html
<a href="https://app.hackthebox.com/users/12345">Alice</a> earned the badge <strong>Machine Maker</strong>
```

Expected: `{ uid: 12345, type: "badge", target: "Machine Maker" }`

### Respect

```html
<a href="https://app.hackthebox.com/users/12345">Alice</a> received respect from <a href="https://app.hackthebox.com/users/99999">Bob</a>
```

Expected: `{ uid: 12345, type: "respect" }`

## Dev workflow

1. Set `IS_DEV_INSTANCE=true` in `.env`
2. Ensure dev log path is writable (`LOG_DIR` in Docker, `./cache/` locally)
3. Run bot; owns append to the log file
4. Replay samples: `npm run test:pusher`

See also [`docs/user/notifications.md`](../user/notifications.md).
