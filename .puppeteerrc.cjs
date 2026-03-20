const {join} = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Changes the cache location for Puppeteer to avoid being cleared by Railway.
  cacheDirectory: join(__dirname, '.chromium-browser'),
};
