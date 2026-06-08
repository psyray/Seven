# Privacy & Account Linking

Seven respects your privacy. You control whether your Discord identity is linked to your HTB account and whether your HTB data appears in bot responses.

## Why link Discord to HTB?

Linking enables:

- **Self queries** — `me`, `my rank`, `my stats` without typing your HTB username
- **Discord mentions** — when a teammate owns a box, Seven can ping your Discord account if you're linked
- **Announce channel** — achievement notifications can mention you (see [notifications.md](notifications.md))

Linking is **optional**. Seven works for general team queries without any personal link.

## How to link

Tell Seven one of:

```
I am 254747 on HTB
My HTB username is YourHtbName
```

Seven stores the association between your Discord user ID and your HTB profile. Only you can link your own Discord account.

## How to unlink or opt out

Say **forget me** and specify what you want:

| Request | Effect |
|---------|--------|
| Unlink Discord only | Removes Discord ↔ HTB association; HTB data may still appear in team scans |
| Blacklist HTB account | Your HTB profile is excluded from rankings, info responses, and future scans |
| Both | Full purge — no Discord link and no HTB data in responses |

Seven confirms each action with a short message.

## Re-allow tracking

If you previously blacklisted your HTB account:

```
remember me again
unforget me
```

Provide your HTB user ID when prompted if needed.

## What data Seven stores

- **Discord links** — mapping Discord user ID → HTB user ID (in Postgres)
- **Ignored members** — HTB IDs you asked to exclude (in Postgres)
- **Team cache** — public HTB achievement data for your team (synced from HTB API)

Seven does not store HTB passwords or session tokens. The bot operator's `HTB_V4_TOKEN` is an App Token used server-side only.

## Privacy tips

- Linking is per-user — each team member chooses independently.
- Blacklisting removes you from **bot responses**; it does not change anything on hackthebox.com itself.
- Admins can see parrot-mode relay messages if debug mode is enabled — this is admin-only and off by default.

## Related

- [User guide](README.md)
- [Commands reference](commands.md)
- [Notifications](notifications.md)
