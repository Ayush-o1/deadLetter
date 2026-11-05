// Shared setup for the browser tests: one app on the test database, one Chrome,
// and small helpers. Call useUi() at the top of a test file.
import { before, after, beforeEach } from 'node:test';
import { makeApp } from './app.js';
import { chromePath, launch } from './browser.js';
import { resetDb } from './testDb.js';

export const SKIP = chromePath() ? false : 'no Chrome found (set CHROME_PATH)';

/** Filled in by useUi(): { api, baseUrl, db, services, close }. */
export const app = {};
let browser;

export function useUi() {
  before(async () => {
    if (SKIP) return;
    Object.assign(app, await makeApp());
    ({ browser } = await launch());
  });
  // Every test starts from the same clean state: no runs, default rules.
  beforeEach(async () => {
    if (SKIP) return;
    await resetDb(app.db);
    await app.services.start();
  });
  after(async () => {
    await browser?.close();
    await app.close?.();
  });
}

/** A fresh page with error tracking, opened at `hash`. */
export async function open(hash = '#/run', { width = 1440, height = 900, baseUrl } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  await page.goto(`${baseUrl ?? app.baseUrl}/${hash}`, { waitUntil: 'networkidle0' });
  return { page, problems };
}

/** Hash navigation does not reload the page, so wait for the new view to render. */
export async function go(page, hash, readySelector) {
  await page.evaluate((h) => (window.location.hash = h), hash);
  await page.waitForSelector(readySelector);
}

export const text = (page, selector) => page.$eval(selector, (el) => el.textContent);
export const count = (page, selector) => page.$$eval(selector, (els) => els.length);

export async function planAndRun(page, request) {
  await page.$eval('.task__input', (el) => (el.value = ''));
  await page.type('.task__input', request);
  await page.click('.task .btn--primary');
  await page.waitForSelector('.plan');
  await page.click('[data-action=run]');
}
