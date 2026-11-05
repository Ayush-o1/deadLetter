// Accessibility regressions found in the final audit (an automated axe-core run over
// twelve UI states). The checks here are computed from the real page, with no extra
// dependency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP, open, planAndRun, useUi } from '../helpers/ui.js';

useUi();

const A = "Read Bob's latest email, summarise it, and send the summary to Alice.";

test('decision-badge secondary text keeps at least 4.5:1 contrast', { skip: SKIP }, async () => {
  const { page } = await open();
  await planAndRun(page, A);
  await page.waitForSelector('.callout--ok');

  // Every badge on the page, computed from the real styles (text colour against the badge colour).
  const results = await page.$$eval('.badge', (badges) => {
    const channels = (css) =>
      css
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number);
    const luminance = ([r, g, b]) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    return badges.flatMap((badge) => {
      const inner = badge.querySelector('.badge__by');
      if (!inner) return [];
      const style = getComputedStyle(inner);
      const [hi, lo] = [
        luminance(channels(style.color)),
        luminance(channels(getComputedStyle(badge).backgroundColor)),
      ].sort((a, b) => b - a);
      return [{ opacity: style.opacity, ratio: (hi + 0.05) / (lo + 0.05) }];
    });
  });
  assert.ok(results.length > 0, 'the page has badges with secondary text');
  for (const r of results) {
    assert.equal(r.opacity, '1', 'secondary badge text must not be faded');
    assert.ok(r.ratio >= 4.5, `contrast is ${r.ratio.toFixed(2)}:1`);
  }
  await page.close();
});

test('the flow diagram is a group of labelled buttons, not an image', { skip: SKIP }, async () => {
  const { page } = await open();
  await planAndRun(page, A);
  await page.waitForSelector('.callout--ok');
  const buttons = await page.$$('.step[data-step="send"] .policy__head .link-btn');
  await buttons[1].click();
  await page.waitForSelector('.flow__svg .node');

  // role="img" would make screen readers treat the focusable boxes as non-interactive.
  assert.equal(await page.$eval('.flow__svg', (svg) => svg.getAttribute('role')), 'group');
  const nodes = await page.$$eval('.flow__svg .node', (all) =>
    all.map((n) => ({
      role: n.getAttribute('role'),
      tabindex: n.getAttribute('tabindex'),
      named: Boolean(n.getAttribute('aria-label')),
    })),
  );
  assert.ok(nodes.length > 0);
  for (const n of nodes) assert.deepEqual(n, { role: 'button', tabindex: '0', named: true });
  await page.close();
});
