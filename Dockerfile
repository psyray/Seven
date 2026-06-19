FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-freefont-ttf \
    ca-certificates \
    dumb-init \
    procps \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/lib/chromium/chromium \
    CHROME_USER_DATA_DIR=/tmp/chrome-user-data \
    HOME=/tmp \
    NODE_ENV=production \
    LOG_DIR=/var/log/sevenbot \
    ACCEPT_HIGHCHARTS_LICENSE=YES

WORKDIR /app

# node:20-bookworm-slim ships uid/gid 1000 — matches host .env bind-mount and ./data/sevenbot-logs
RUN mkdir -p /var/log/sevenbot \
  && chown -R node:node /app /var/log/sevenbot

COPY --chown=node:node package*.json ./
USER node
RUN npm ci --omit=dev

COPY --chown=node:node config/htb.js ./config/htb.js
COPY --chown=node:node . .

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "bot.js"]
