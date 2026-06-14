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

RUN addgroup --system seven && adduser --system --ingroup seven seven \
  && mkdir -p /var/log/sevenbot \
  && chown seven:seven /app /var/log/sevenbot

COPY --chown=seven:seven package*.json ./
USER seven
RUN npm ci --omit=dev

COPY --chown=seven:seven config/htb.js ./config/htb.js
COPY --chown=seven:seven . .

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "bot.js"]
