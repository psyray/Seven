👩‍💻️ _If you enjoy Seven, feel free to show some love so I can create more projects like this!_

[![ko-fi](https://www.ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/F1F61UIUZ)

# 💬 Seven

#### An AI-powered Discord Bot for [Hack The Box](https://www.hackthebox.com) teams.

![Seven's visage](/branding/seven_thumb_128.png)

## 🍉 About

Seven is a semi-intelligent AI chatbot built with [DialogFlow](https://dialogflow.cloud.google.com/) and [Node.js](https://nodejs.org/), whose purpose is to make Hack The Box achievement data accessible and convenient within team Discord channels.

## 🦾 Capabilities

Seven can provide information about:

- Herself / her functionality (try asking `help`, `what can you do for me`)
- Machines and challenges (active, retired and unreleased)
- Fortresses, endgames, and pro labs
- Ownage (e.g. which team members did what on HTB)
- Team members — profiles, ranks, achievement charts
- Team details, global rank, and leaderboards
- Filtered lists (hardest boxes, linux machines, incomplete challenges, `list prolabs`, …)
- Real-time achievement notifications in your announce channel

## 🃏 Talking to Seven

Seven is super flexible and doesn't rely on templates or specific wordings. In server channels, prefix with `seven` (e.g. `seven help`). In DMs, no prefix is needed.

**Quick start:** `seven help` — full in-bot manual.

More examples: [docs/user/examples.md](docs/user/examples.md) | Full command list: [docs/user/commands.md](docs/user/commands.md)

<details>
<summary>📸 Example screenshots</summary>

<img src="docs/img/get_help.png?raw=true" width="642">
<img src="docs/img/get_box_owners_2.png?raw=true" width="642">
<img src="docs/img/get_box_info.png?raw=true" width="642">
<img src="docs/img/get_member_info.png?raw=true" width="642">
<img src="docs/img/get_team_info.png?raw=true" width="642">

</details>

## 👥 Privacy

Seven cares about privacy and allows channel users to:

- Associate or disassociate their Discord ID to their HTB account ID
- Disallow (or re-allow) inclusion of their HTB data in bot responses

Details: [docs/user/privacy.md](docs/user/privacy.md)

## 📚 Documentation

| Audience | Guide |
|----------|-------|
| **Discord users** | [docs/user/README.md](docs/user/README.md) |
| **Server admins** | [docs/admin/setup.md](docs/admin/setup.md) — deploy with Docker |
| **Developers** | [CONTRIBUTING.md](CONTRIBUTING.md) |
| **Full index** | [docs/README.md](docs/README.md) |

## 🛠️ Deployment

### Docker (recommended)

```bash
cp static/templates/.env.docker.example .env
# Fill BOT_TOKEN, HTB_V4_TOKEN, HTB_REFRESH_TOKEN, GOOGLE_*, DISCORD_*, HTB_TEAM_ID

npm run docker:up
npm run docker:logs
```

Step-by-step guide: [docs/admin/setup.md](docs/admin/setup.md)

## 💬 Support

For deployment help, see [docs/admin/setup.md](docs/admin/setup.md) and [docs/admin/troubleshooting.md](docs/admin/troubleshooting.md).

For AI-assisted development (Cursor rules, skills, architecture): [AGENTS.md](AGENTS.md)

## 📜 Roadmap

- [x] Member / team stat charts (Highcharts + Puppeteer)
- [x] Machine and challenge filters and lists
- [x] Self info via Discord ↔ HTB linking
- [x] Docker Compose deployment with PostgreSQL
- [x] HTB v4/v5 API migration (OAuth access/refresh tokens)
- [x] Real-time Pusher notifications + activity fallback + Postgres event log
- [x] Offline smoke test suite
- [ ] RTFM advice for stuck users
- [ ] Large member list responses (Discord embed limits)
- [ ] Built-in web control interface

Ideas and bugs: [GitHub Issues](https://github.com/psyray/Seven/issues)
