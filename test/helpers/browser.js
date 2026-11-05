// Drives the installed Chrome (no browser download) against a running test app.
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export const chromePath = () => CANDIDATES.find((p) => existsSync(p));

/** Launch a browser and a page that records console errors and failed requests. */
export async function launch({ width = 1440, height = 900, scale = 2 } = {}) {
  const executablePath = chromePath();
  if (!executablePath) throw new Error('No Chrome found. Set CHROME_PATH.');
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  const problems = [];
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('requestfailed', (req) => problems.push(`requestfailed: ${req.url()}`));
  page.on(
    'response',
    (res) =>
      res.status() >= 400 &&
      !res.url().includes('/api/') &&
      problems.push(`http ${res.status()}: ${res.url()}`),
  );
  return { browser, page, problems };
}
