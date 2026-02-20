const puppeteer = require('puppeteer');
const logger = require('./logger');

let browser = null;

async function getBrowser() {
  if (browser && browser.connected) return browser;

  logger.info('browser', 'Launching Puppeteer...');
  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });

  logger.info('browser', 'Browser launched');
  return browser;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    logger.info('browser', 'Browser closed');
  }
}

module.exports = { getBrowser, closeBrowser };
