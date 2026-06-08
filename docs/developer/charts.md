# Charts & Puppeteer

Seven renders member achievement charts and a binary clock as PNG images using Highcharts and Puppeteer (headless Chromium).

## Pipeline

```
User query → getMemberChart / getTime intent
    → helpers/chart-messages.js or helpers/binclock.js
    → modules/charts/index_new.js (Highcharts config → HTML)
    → Puppeteer screenshot → PNG buffer
    → Discord embed attachment
```

## Key files

| File | Role |
|------|------|
| `modules/charts/index_new.js` | Main chart renderer; checks `CHART_RENDER_DISABLED` |
| `modules/charts/htbCharts.js` | Highcharts theme and defaults |
| `helpers/chart-messages.js` | Build progress/activity chart embeds; graceful error handling |
| `helpers/chart-term.js` | Normalize intervals (`6 months` → `6M`, default `1Y`) |
| `helpers/binclock.js` | Binary clock image via Puppeteer |
| `helpers/puppeteer-launch.js` | Shared Chromium launch options |

## Environment variables

| Variable | Description |
|----------|-------------|
| `CHART_RENDER_DISABLED=1` | Skip rendering; embeds sent without images |
| `PUPPETEER_EXECUTABLE_PATH` | Chromium binary (Docker: `/usr/lib/chromium/chromium`) |
| `CHROMIUM_PATH` | Alternative to above |
| `CHROME_USER_DATA_DIR` | Headless profile directory |
| `HC_FONT_STRING` | Highcharts font (default `'Lato', sans-serif`) |
| `HC_FONT_SIZE` | Highcharts font size (default `14px`) |
| `NODE_ENV=chartdev` | Non-headless Puppeteer with devtools (debug) |

Docker Compose sets `PUPPETEER_EXECUTABLE_PATH`, `CHROME_USER_DATA_DIR`, and `shm_size: 256mb` for stability.

## Disable charts

Set in `.env`:

```
CHART_RENDER_DISABLED=1
```

Member chart queries still respond with text/embed metadata; only the image is omitted.

## Local development

Without Docker, install Chromium and point Puppeteer:

```bash
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
npm run test:charts
```

Debug visually:

```bash
NODE_ENV=chartdev node scripts/chart-smoke.js
```

## Docker

The Dockerfile installs system Chromium and sets:

- `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true`
- `PUPPETEER_EXECUTABLE_PATH=/usr/lib/chromium/chromium`

The bot container runs read-only with `tmpfs /tmp` — chart rendering uses `/tmp/chrome-user-data`.

## Error handling

`helpers/chart-messages.js` catches Puppeteer failures and still sends a useful embed without crashing the bot. Check `sevenbot-error.log` for Chromium launch errors.

## Testing

```bash
npm run test:charts
```

See [testing.md](testing.md).

## Related

- [User commands — charts](../user/commands.md)
- [Admin troubleshooting — charts](../admin/troubleshooting.md)
