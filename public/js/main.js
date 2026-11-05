// App shell: header, tab navigation, and a small hash router.
import { api } from './api.js';
import { h, mount } from './dom.js';
import { icon, postmark } from './icons.js';
import { renderHistory } from './views/history.js';
import { renderRules } from './views/rules.js';
import { renderRun } from './views/run.js';

const VIEWS = {
  run: { label: 'Run', render: renderRun },
  rules: { label: 'Rules', render: renderRules },
  history: { label: 'History', render: renderHistory },
};

const app = document.getElementById('app');
let cleanup = () => {};

const badge = h('span', { class: 'nav__badge', hidden: true, 'aria-label': 'decisions waiting' });
const provider = h('span', { class: 'provider muted small' });
const links = Object.entries(VIEWS).map(([key, v]) =>
  h(
    'a',
    { class: 'nav__link', href: `#/${key}`, dataset: { view: key } },
    v.label,
    key === 'run' && badge,
  ),
);

const main = h('main', { id: 'main', class: 'content', tabindex: -1 });
mount(
  app,
  h('a', { class: 'skip', href: '#main' }, 'Skip to content'),
  h(
    'header',
    { class: 'top' },
    h(
      'div',
      { class: 'top__inner' },
      h(
        'a',
        { class: 'brand', href: '#/run', 'aria-label': 'deadLetter home' },
        postmark(30),
        h('span', { class: 'brand__name' }, 'dead', h('b', null, 'Letter')),
      ),
      h('nav', { class: 'nav', 'aria-label': 'Main' }, links),
      h('span', { class: 'spacer' }),
      provider,
    ),
  ),
  main,
);

function route() {
  const [, view = 'run', param] = location.hash.split('/');
  const key = VIEWS[view] ? view : 'run';
  cleanup();
  main.replaceChildren();
  for (const a of links) a.toggleAttribute('aria-current', a.dataset.view === key);
  for (const a of links)
    a.dataset.view === key
      ? a.setAttribute('aria-current', 'page')
      : a.removeAttribute('aria-current');
  document.title = `${VIEWS[key].label} · deadLetter`;
  cleanup = VIEWS[key].render(main, {
    param: param ? decodeURIComponent(param) : undefined,
    // silent: change the URL without re-rendering (the view is already showing it)
    navigate: (hash, { silent = false } = {}) => {
      if (silent) history.replaceState(null, '', hash);
      else location.hash = hash;
    },
  });
}

window.addEventListener('hashchange', route);
route();

// Header status: which models are in use, and how many decisions are waiting.
async function tick() {
  try {
    const [meta, pending] = await Promise.all([api.get('/api/meta'), api.get('/api/approvals')]);
    provider.replaceChildren(
      icon('shield', 13),
      meta.modelProvider === 'mock' ? 'Demo models, fake tools' : 'Live model, fake tools',
    );
    const n = pending.approvals.length;
    badge.hidden = n === 0;
    badge.textContent = String(n);
  } catch {
    /* the view shows its own errors */
  }
}
tick();
setInterval(tick, 2000);
window.addEventListener('dl-refresh', tick);
