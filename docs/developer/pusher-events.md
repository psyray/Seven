# HTB socket event formats

> **November 2026 migration.** HTB moved its web socket to a self-hosted Pusher-compatible endpoint:
> `wss://ws.prod.htb.systems`, app key `239b8f4dc420f11e3fae`, JSON payloads. Seven connects there
> (`HTB_PUSHER_HOST` / `HTB_PUSHER_KEY` override both values) and subscribes to the public `general`
> channel. There is **no global owns channel** any more: `TEAMS_<teamId>` only carries membership
> events, so team owns are announced from `GET team/activity/<teamId>` by the notification router
> (see `docs/admin/operations.md`).

## Channels used by Seven

| Channel | Event | Purpose |
|---------|-------|---------|
| `general` | `blood-created` | Global first blood, payload `{ message, userId }` |
| `general` | `notify-all-users` | Site-wide notice, payload `{ data: { message } }` (logged only) |

Other channels exposed by the HTB app, not used by Seven:

| Channel | Events |
|---------|--------|
| `TEAMS_<teamId>` | `join-request`, `accept-join-request`, `reject-invitation`, `user-left`, `kick-user`, `make-captain` |
| `private-<userId>` | personal notices, `machine-state`, Flock/Pwnbox events |
| `private-machine-<id>-<x>` | per-machine state |

## First blood routing

```
HtbPusherSubscription 'blood' event  [pusher-htb.js]
  → NotificationRouter.handleBloodCreated({ uid, message })
  → helpers/blood-parser.js resolves the machine/challenge name against the in-memory catalog
  → handleOwnEvent({ blood: true, type, target, flag })
```

The parser returns `null` for ambiguous messages (no catalog match, or a machine blood without a
`user`/`root`/`system` word). Those events are logged and left to the team activity fallback, which
carries structured fields and shares the same `ownAnnouncementKey` dedup key, so an own can never be
announced twice.

## Legacy HTML feed

The previous SaaS feed (`ws-eu.pusher.com`, key `97608bf7532e6f0fe898`) and its HTML payloads
(`owns-channel`, `infobox-channel`, `notifications-channel`, `joins-channel`, `shoutbox-channel`)
no longer carry traffic. The parsing helpers (`parsePusherEvent`, `HtbPusherEvent`) are kept for the
parser smoke tests and for any private deployment that still receives those payloads.

Collect raw socket payloads with `IS_DEV_INSTANCE=true` — `pusherevent` objects append to
`LOG_DIR/PUSHER_MSG_LOG.json` (Docker: `/var/log/sevenbot/PUSHER_MSG_LOG.json`). Blood payloads are
logged by `pusher-htb` (`Pusher blood event received`).

Auth: private channels use `POST ${HTB_APP_BASE}/pusher/auth` with Bearer `HTB_V4_TOKEN`; the public
`general` channel needs no authorization.

## Runtime routing (`NotificationRouter`)

```
HtbPusherSubscription [pusher-htb.js]
  → NotificationRouter.handlePusherEvent()
```
