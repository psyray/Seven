FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-freefont-ttf \
    ca-certificates \
    dumb-init \
    procps \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    LOG_DIR=/var/log/sevenbot \
    ACCEPT_HIGHCHARTS_LICENSE=YES

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN addgroup --system seven && adduser --system --ingroup seven seven \
  && mkdir -p /var/log/sevenbot && chown -R seven:seven /app /var/log/sevenbot

USER seven

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "bot.js"]
