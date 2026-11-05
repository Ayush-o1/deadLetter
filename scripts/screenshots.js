// `npm run screenshots`: drives the real UI in Chrome and saves the images used in
// the README and the user guide to docs/screenshots/.
//
// It runs against the TEST database (it resets it), with the demo models and fake
// tools, so nothing real is touched and the images are reproducible.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeApp } from '../test/helpers/app.js';
import { launch } from '../test/helpers/browser.js';

const OUT = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const A = "Read Bob's latest email, summarise it, and send the summary to Alice.";
const D = 'Read brief.txt and email its summary to the project lead.';
const COND = "Read Bob's latest email. If it is urgent, tell Alice, otherwise tell Carol.";

const app = await makeApp();
const { browser, page, problems } = await launch({ width: 1440, height: 900, scale: 1.5 });
const shot = (name, opts = {}) => page.screenshot({ path: `${OUT}${name}.png`, ...opts });
const go = async (hash, ready) => {
  await page.evaluate((h) => (window.location.hash = h), hash);
  await page.waitForSelector(ready);
  await new Promise((r) => setTimeout(r, 250));
};

async function finishViaApi(request, answer) {
  const run = await app.api.post('/api/runs', { request });
  await app.api.post(`/api/runs/${run.json.id}/execute`);
  for (let i = 0; i < 300; i++) {
    const snap = (await app.api.get(`/api/runs/${run.json.id}`)).json;
    if (snap.status === 'awaiting_approval' && answer) {
      await app.api.post(`/api/approvals/${snap.pendingApprovals[0].id}/resolve`, {
        action: answer,
      });
    } else if (['completed', 'blocked', 'failed', 'cancelled'].includes(snap.status)) return snap;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`run did not finish: ${request}`);
}

try {
  // Some history first.
  await finishViaApi(A);
  await finishViaApi(COND, 'reject');
  await finishViaApi('Delete the file notes.txt', 'reject');

  await page.goto(`${app.baseUrl}/#/run`, { waitUntil: 'networkidle0' });
  await shot('run-empty');

  await page.type('.task__input', D);
  await page.click('.task .btn--primary');
  await page.waitForSelector('.plan');
  await shot('run-plan');

  await page.click('[data-action=run]');
  await page.waitForSelector('.acard');
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 300));
  await shot('run-approval');

  await page.click('.acard__actions .btn--primary');
  await page.waitForSelector('.callout--ok');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('run-finished', { fullPage: true });

  const traceButtons = await page.$$('.step[data-step="send"] .policy__head .link-btn');
  await traceButtons[1].click();
  await page.waitForSelector('.flow__svg .node--untrusted');
  await page.click('.node--arg.node--untrusted');
  await shot('flow-explorer');
  await page.keyboard.press('Escape');

  await go('#/rules', '.rule');
  await shot('rules', { fullPage: true });

  await go('#/history', '.run-row');
  await page.click('.run-row');
  await page.waitForSelector('.hist__detail .trace');
  await shot('history');

  await go('#/lab', '.scn');
  await page.click('[data-scenario="attack-01-email-forward-inbox"]');
  await page.click('[data-action=run-scenario]');
  await page.waitForSelector('.diff');
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('lab-scenario', { fullPage: true });

  await page.click('[data-tab=evaluation]');
  await page.waitForSelector('[data-action=run-eval]');
  await page.click('[data-action=run-eval]');
  await page.waitForSelector('.chart__svg');
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('lab-evaluation', { fullPage: true });

  console.log(`Saved screenshots to ${OUT}`);
  if (problems.length > 0) console.log('Browser problems:', problems);
} finally {
  await browser.close();
  await app.close();
}
