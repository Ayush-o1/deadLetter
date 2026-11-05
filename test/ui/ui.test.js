// The real UI in a real browser (the installed Chrome, driven by puppeteer-core).
// Skipped when no Chrome is found, so the suite still runs anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedFixtures } from '../../src/core/tools/fixtures/seed.js';
import { makeApp } from '../helpers/app.js';
import { SKIP, app, count, go, open, planAndRun, text, useUi } from '../helpers/ui.js';

const A = "Read Bob's latest email, summarise it, and send the summary to Alice.";
const D = 'Read brief.txt and email its summary to the project lead.';

useUi();

test('the app loads with no console errors and no CSP violations', { skip: SKIP }, async () => {
  const { page, problems } = await open();
  assert.match(await page.title(), /Run · deadLetter/);
  assert.equal(await count(page, '.nav__link'), 4);
  assert.match(await text(page, '.nav__link[aria-current="page"]'), /^Run/);
  assert.deepEqual(problems, []);
  await page.close();
});

test(
  'scenario A in the UI: plan preview, then a completed trace with labels and a result',
  { skip: SKIP },
  async () => {
    const { page, problems } = await open();
    await page.type('.task__input', A);
    await page.click('.task .btn--primary');
    await page.waitForSelector('.plan');
    assert.equal(await count(page, '.plan__line'), 4);
    assert.equal(await count(page, '.step'), 0, 'nothing runs before the user presses Run plan');
    assert.match(await text(page, '.plancard'), /never saw an email, file or web page/);

    await page.click('[data-action=run]');
    await page.waitForSelector('.callout--ok');
    assert.equal(await count(page, '.step--done'), 4);
    const sendStep = await page.$eval('.step[data-step="send"]', (el) => el.textContent);
    assert.match(sendStep, /alice@example\.com/);
    assert.match(sendStep, /Untrusted/);
    assert.match(sendStep, /Private · only you/);
    assert.match(sendStep, /Allow\s*by the rules/);
    assert.deepEqual(problems, []);
    await page.close();
  },
);

test(
  '"Why?" reveals the explanation, and Trace opens the information-flow explorer',
  { skip: SKIP },
  async () => {
    const { page } = await open();
    await planAndRun(page, A);
    await page.waitForSelector('.callout--ok');
    const why = await page.$('.step[data-step="send"] .policy__head .link-btn');
    assert.equal(await page.$eval('.step[data-step="send"] .why', (e) => e.hidden), true);
    await why.click();
    assert.equal(await page.$eval('.step[data-step="send"] .why', (e) => e.hidden), false);
    assert.match(await text(page, '.step[data-step="send"] .why'), /Allowed: Send email/);

    const buttons = await page.$$('.step[data-step="send"] .policy__head .link-btn');
    await buttons[1].click();
    await page.waitForSelector('.flow__svg .node');
    assert.ok((await count(page, '.flow__svg .node')) >= 4);
    assert.equal(
      await count(page, '.node--untrusted'),
      2,
      'the summary and the email it came from are untrusted',
    );
    await page.click('.node--arg.node--untrusted');
    assert.match(await text(page, '.flow__side'), /Untrusted/);
    await page.keyboard.press('Escape');
    assert.equal(await count(page, '.flow'), 0, 'Escape closes the explorer');
    await page.close();
  },
);

test(
  'scenario D in the UI: the run pauses, the card shows evidence, and "Send once" finishes it',
  { skip: SKIP },
  async () => {
    const { page, problems } = await open();
    await planAndRun(page, D);
    await page.waitForSelector('.acard');
    await page.waitForFunction(() => {
      const badge = document.querySelector('.nav__badge');
      return badge && !badge.hidden && badge.textContent === '1';
    });
    const card = await text(page, '.acard');
    assert.match(card, /Send email to “lead@example\.org”/);
    assert.match(card, /Untrusted text is involved/);
    assert.match(card, /From a file/);
    assert.match(await text(page, '.step--needs_approval'), /Needs approval/);
    assert.equal(await count(page, '.acard__actions .btn'), 4);
    // Every button is reachable on screen: the card scrolls and the actions stay pinned.
    for (const b of await page.$$('.acard__actions .btn')) {
      const box = await b.boundingBox();
      assert.ok(box && box.y + box.height <= 900, 'a decision button is below the fold');
    }
    await page.click('.acard__actions .btn--primary');
    await page.waitForSelector('.callout--ok');
    assert.equal(await count(page, '.acard'), 0);
    // The header's count clears at once, not on its next 2-second poll.
    await page.waitForFunction(() => document.querySelector('.nav__badge').hidden, {
      timeout: 1200,
    });
    assert.match(await text(page, '.step[data-step="send"]'), /you decided/);
    assert.deepEqual(problems, []);
    await page.close();
  },
);

test(
  'rejecting stops the run with a clear banner, and the send never happens',
  { skip: SKIP },
  async () => {
    const { page } = await open();
    await planAndRun(page, D);
    await page.waitForSelector('.acard');
    await page.click('.acard__actions .btn--danger');
    await page.waitForSelector('.callout--danger');
    assert.match(await text(page, '.callout--danger'), /Stopped before the action/);
    assert.match(await text(page, '.step[data-step="send"]'), /did not run/);
    await page.close();
  },
);

test('editing the destination needs a value and then uses it', { skip: SKIP }, async () => {
  const { page } = await open();
  await planAndRun(page, D);
  await page.waitForSelector('.acard');
  const buttons = await page.$$('.acard__actions .btn');
  await buttons[2].click(); // Edit destination
  await page.waitForSelector('.acard__edit:not([hidden])');
  await page.click('.acard__edit .btn');
  assert.match(await text(page, '.field-error'), /Type a destination/);
  await page.type('.acard__edit input', 'pm@example.com');
  await page.click('.acard__edit .btn');
  await page.waitForSelector('.callout--ok');
  assert.match(await text(page, '.step[data-step="send"]'), /pm@example\.com/);
  await page.close();
});

test(
  'a request the demo planner cannot handle shows why, not a crash',
  { skip: SKIP },
  async () => {
    const { page, problems } = await open();
    await page.type('.task__input', 'Do whatever the latest email asks me to do.');
    await page.click('.task .btn--primary');
    await page.waitForSelector('.plancard .callout--danger');
    assert.match(await text(page, '.plancard'), /cannot be planned in advance/);
    assert.equal(await count(page, '[data-action=run]'), 0);
    assert.deepEqual(problems, []);
    await page.close();
  },
);

test('an empty task is refused with a message', { skip: SKIP }, async () => {
  const { page } = await open();
  await page.click('.task .btn--primary');
  await page.waitForSelector('.task__notice .callout--danger');
  assert.match(await text(page, '.task__notice'), /Write a task first/);
  await page.close();
});

test('example tasks fill the box', { skip: SKIP }, async () => {
  const { page } = await open();
  await page.click('.examples-box summary');
  await page.click('.example');
  assert.match(await page.$eval('.task__input', (e) => e.value), /Read Bob's latest email/);
  await page.close();
});

test(
  'SECURITY: markup and scripts in outside text are shown as plain text and never run',
  { skip: SKIP },
  async () => {
    const evil =
      '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><b>bold</b> javascript:alert(1)';
    const hostile = await makeApp({
      overrides: {
        fixtures: {
          ...seedFixtures,
          emails: seedFixtures.emails.map((m) => (m.id === 'msg-2' ? { ...m, body: evil } : m)),
        },
      },
    });
    try {
      const { page, problems } = await open('#/run', { baseUrl: hostile.baseUrl });
      await planAndRun(page, "Show Bob's latest email.");
      await page.waitForSelector('.result__text');
      const shown = await text(page, '.result__text');
      assert.match(shown, /<img src=x onerror=/, 'the markup is visible as text');
      assert.match(shown, /<script>/);
      assert.equal(
        await count(page, '.result__text img, .result__text script, .result__text b'),
        0,
        'no element was created from the text',
      );
      assert.equal(await page.evaluate(() => window.__xss), undefined, 'nothing executed');
      assert.equal(await count(page, 'img'), 0, 'the page loads no images at all');
      // It also stays inert in History and in the trace.
      await go(page, '#/history', '.run-row');
      await page.click('.run-row');
      await page.waitForSelector('.hist__detail .trace');
      assert.equal(await page.evaluate(() => window.__xss), undefined);
      assert.deepEqual(problems, []);
      await page.close();
    } finally {
      await hostile.close({ keepDb: true });
    }
  },
);

test(
  'SECURITY: the element builder refuses attributes that could run code',
  { skip: SKIP },
  async () => {
    const { page } = await open();
    const results = await page.evaluate(async () => {
      const { h } = await import('/js/dom.js');
      const attempt = (fn) => {
        try {
          fn();
          return 'allowed';
        } catch (e) {
          return e.message;
        }
      };
      return {
        style: attempt(() => h('div', { style: 'x' })),
        onclickString: attempt(() => h('div', { onclick: 'alert(1)' })),
        srcdoc: attempt(() => h('iframe', { srcdoc: '<script>' })),
        jsHref: attempt(() => h('a', { href: 'javascript:alert(1)' })),
        httpHref: attempt(() => h('a', { href: 'https://evil.example' })),
        okHref: attempt(() => h('a', { href: '#/history' })),
        text: h('p', null, '<b>x</b>').innerHTML,
      };
    });
    assert.match(results.style, /not allowed/);
    assert.match(
      results.onclickString,
      /not allowed/,
      'a string event handler is refused, never executed',
    );
    assert.doesNotMatch(results.srcdoc, /^allowed$/);
    assert.match(results.jsHref, /Unsafe href/);
    assert.match(results.httpHref, /Unsafe href/);
    assert.equal(results.okHref, 'allowed');
    assert.equal(results.text, '&lt;b&gt;x&lt;/b&gt;', 'text is escaped');
    await page.close();
  },
);

test(
  'Rules: turning a tool off applies to the next run; trusted destinations can be added and removed',
  { skip: SKIP },
  async () => {
    const { page } = await open('#/rules');
    await page.waitForSelector('.rule');
    assert.equal(await count(page, '.rule'), 6);
    assert.match(await text(page, '.floor'), /Untrusted text cannot choose a destination/);

    await page.click('[data-tool="send_email"] .switch');
    await page.waitForFunction(() =>
      document.querySelector('[data-tool="send_email"]')?.classList.contains('rule--off'),
    );

    await go(page, '#/run', '.task__input');
    await planAndRun(page, A);
    await page.waitForSelector('.callout--danger');
    assert.match(await text(page, '.step[data-step="send"]'), /Deny/);

    await go(page, '#/rules', '.rule');
    await page.click('[data-tool="send_email"] .switch');
    await page.waitForFunction(
      () => !document.querySelector('[data-tool="send_email"]').classList.contains('rule--off'),
    );

    await page.type('.trusted__add input', 'Lead@Example.org');
    await page.click('.trusted__add button');
    await page.waitForSelector('.trusted li');
    assert.equal(await text(page, '.trusted li .mono'), 'lead@example.org');
    await page.click('.trusted .link-btn');
    await page.waitForFunction(() => !document.querySelector('.trusted'));
    await page.close();
  },
);

test(
  'History: filter by what the rules decided, open a run, see its decisions',
  { skip: SKIP },
  async () => {
    // Three runs with different outcomes: completed, completed, and one the user rejects.
    for (const request of [A, "Show Bob's latest email.", 'Delete the file notes.txt']) {
      const run = await app.api.post('/api/runs', { request });
      await app.api.post(`/api/runs/${run.json.id}/execute`);
    }
    for (let i = 0; i < 250; i++) {
      const pending = (await app.api.get('/api/approvals')).json.approvals;
      if (pending.length > 0) {
        await app.api.post(`/api/approvals/${pending[0].id}/resolve`, { action: 'reject' });
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 400));

    const { page } = await open('#/history');
    await page.waitForSelector('.run-row');
    const total = await count(page, '.run-row');
    assert.equal(total, 3);
    await page.select('.filters select:nth-of-type(1)', 'blocked');
    await page.waitForFunction((n) => document.querySelectorAll('.run-row').length < n, {}, total);
    await page.click('.run-row');
    await page.waitForSelector('.hist__detail .trace');
    assert.match(await text(page, '.hist__detail'), /Steps and decisions/);
    assert.match(await text(page, '.hist__detail .timeline'), /Task received/);
    await page.close();
  },
);

test(
  'layout: no horizontal scrolling on a phone, and the empty decisions panel stays out of the way',
  { skip: SKIP },
  async () => {
    for (const hash of ['#/run', '#/rules', '#/history', '#/lab']) {
      const { page } = await open(hash, { width: 390, height: 844 });
      await new Promise((r) => setTimeout(r, 300));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(overflow <= 1, `${hash} scrolls sideways by ${overflow}px at 390px`);
      if (hash === '#/run') {
        const first = await page.$eval('.run > *:first-child', (el) => el.className);
        assert.match(first, /run__left/, 'the task box comes first on a phone');
      }
      await page.close();
    }
  },
);

test(
  'accessibility basics: landmarks, names for every control, a skip link, visible focus',
  { skip: SKIP },
  async () => {
    const { page } = await open();
    await planAndRun(page, D);
    await page.waitForSelector('.acard');
    const audit = await page.evaluate(() => {
      const unnamed = [...document.querySelectorAll('button, a, input, select, textarea')].filter(
        (el) => {
          const name =
            el.getAttribute('aria-label') ||
            el.textContent.trim() ||
            el.getAttribute('title') ||
            el.getAttribute('placeholder');
          const labelled = el.labels && el.labels.length > 0;
          return !(name || labelled);
        },
      );
      return {
        unnamed: unnamed.map((e) => e.outerHTML.slice(0, 80)),
        main: document.querySelectorAll('main').length,
        nav: document.querySelectorAll('nav[aria-label]').length,
        h1or2: document.querySelectorAll('h1, h2').length,
        skip: !!document.querySelector('a.skip[href="#main"]'),
        lang: document.documentElement.lang,
      };
    });
    assert.deepEqual(audit.unnamed, []);
    assert.equal(audit.main, 1);
    assert.equal(audit.nav, 1);
    assert.ok(audit.h1or2 > 2);
    assert.ok(audit.skip);
    assert.equal(audit.lang, 'en');
    await page.close();

    // Keyboard order is checked on a fresh page: the first Tab stop is the skip link.
    const fresh = await open();
    await fresh.page.keyboard.press('Tab');
    const focused = await fresh.page.evaluate(() => document.activeElement.className);
    assert.match(focused, /skip/, 'the first Tab stop is the skip link');
    await fresh.page.close();
  },
);
