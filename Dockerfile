FROM ghcr.io/puppeteer/puppeteer:22

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Switch to root to set up dirs, then back to pptruser
USER root
WORKDIR /home/pptruser/app

COPY package*.json ./
RUN npm install --omit=dev && chown -R pptruser:pptruser .

COPY --chown=pptruser:pptruser . .

USER pptruser

EXPOSE 8080

CMD ["node", "src/index.js"]
