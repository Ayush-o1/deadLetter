// The History screen: every past run, searchable by what the rules decided, and
// the full audit trail of any one run.
import { api, query } from '../api.js';
import { callout, emptyState, labelChips, statusPill } from '../components/chips.js';
import { openFlow } from '../components/flowGraph.js';
import { trace } from '../components/trace.js';
import { h, mount } from '../dom.js';
import { STATUS, clock, timeAgo } from '../format.js';

const PAGE = 25;

function option(value, label) {
  return h('option', { value }, label);
}

function tally(d) {
  const part = (n, cls, text) =>
    n > 0 && h('span', { class: ['mini', `mini--${cls}`] }, `${n} ${text}`);
  return h(
    'span',
    { class: 'tally' },
    part(d.allow, 'allow', 'allowed'),
    part(d.ask, 'ask', 'asked'),
    part(d.deny, 'deny', 'denied'),
    d.allow + d.ask + d.deny === 0 && h('span', { class: 'muted small' }, 'no tool calls'),
  );
}

const EVENT_TEXT = {
  created: 'Task received',
  planned: 'Plan written',
  plan_failed: 'Planning failed',
  started: 'Run started',
  approval_requested: 'Waited for a decision',
  approval_resolved: 'Decision made',
  cancel_requested: 'Cancel requested',
  cancelled: 'Cancelled',
  finished: 'Finished',
  interrupted: 'Interrupted by a restart',
};

function detail(run) {
  return h(
    'div',
    { class: 'stack' },
    h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'row wrap' },
        h('h2', null, 'Task'),
        statusPill(run.status),
        h('span', { class: 'spacer' }),
        h('span', { class: 'muted small' }, `${new Date(run.createdAt).toLocaleString()}`),
      ),
      h('p', { class: 'detail__request' }, run.request),
      run.error && callout(run.status === 'completed' ? 'info' : 'danger', null, run.error.message),
    ),
    run.plan &&
      h(
        'section',
        { class: 'card' },
        h('h2', null, 'Steps and decisions'),
        trace(run, { onTrace: (step) => openFlow(run.id, step) }),
      ),
    run.results.length > 0 &&
      h(
        'section',
        { class: 'card' },
        h('h2', null, 'Result'),
        run.results.map((r) =>
          h(
            'article',
            { class: 'result' },
            h(
              'header',
              { class: 'result__head' },
              h('h3', null, r.title ?? 'Result'),
              labelChips(r.label),
            ),
            h('pre', { class: 'result__text' }, r.text ?? r.preview),
            r.text === undefined &&
              r.truncated &&
              h(
                'p',
                { class: 'small muted' },
                'Only a short preview is kept; the full text is not stored.',
              ),
          ),
        ),
      ),
    h(
      'section',
      { class: 'card' },
      h('h2', null, 'Timeline'),
      h(
        'ol',
        { class: 'timeline' },
        run.events.map((e) =>
          h(
            'li',
            null,
            h('span', { class: 'mono small muted' }, clock(e.at)),
            h(
              'span',
              null,
              EVENT_TEXT[e.type] ?? e.type,
              e.detail?.action && ` (${e.detail.action.replace(/_/g, ' ')})`,
              e.detail?.status && `: ${STATUS[e.detail.status]?.label ?? e.detail.status}`,
            ),
          ),
        ),
      ),
    ),
  );
}

export function renderHistory(root, { param: openId }) {
  const filters = { q: '', status: '', decision: '', tool: '', decidedBy: '' };
  let runs = [];
  let limit = PAGE;
  let debounce;
  let stopped = false;

  const q = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search what you asked…',
    'aria-label': 'Search requests',
    oninput: (e) => change('q', e.target.value, true),
  });
  const select = (key, label, options) =>
    h(
      'label',
      { class: 'filter' },
      h('span', { class: 'filter__label' }, label),
      h(
        'select',
        { class: 'input select', onchange: (e) => change(key, e.target.value) },
        option('', 'Any'),
        options.map(([v, t]) => option(v, t)),
      ),
    );
  const list = h('div', { class: 'hist__list' });
  const detailBox = h('div', { class: 'hist__detail' });

  const toolSelect = h('span');
  root.append(
    h(
      'div',
      { class: 'page hist' },
      h(
        'header',
        { class: 'page__head' },
        h('h1', null, 'History'),
        h(
          'p',
          { class: 'muted' },
          'Every task, with the decision made on each action and why. Filter by what the rules decided.',
        ),
      ),
      h(
        'div',
        { class: 'filters card' },
        h(
          'label',
          { class: 'filter filter--grow' },
          h('span', { class: 'filter__label' }, 'Search'),
          q,
        ),
        select(
          'status',
          'Status',
          Object.entries(STATUS).map(([k, v]) => [k, v.label]),
        ),
        select('decision', 'Some step was', [
          ['allow', 'Allowed'],
          ['ask', 'Asked'],
          ['deny', 'Denied'],
        ]),
        select('decidedBy', 'Decided by', [
          ['engine', 'The rules'],
          ['user', 'You'],
        ]),
        toolSelect,
      ),
      h('div', { class: 'hist__layout' }, list, detailBox),
    ),
  );

  function change(key, value, debounced = false) {
    filters[key] = value;
    limit = PAGE;
    clearTimeout(debounce);
    if (debounced) debounce = setTimeout(load, 250);
    else load();
  }

  async function load() {
    try {
      const res = await api.get(`/api/runs${query({ ...filters, limit })}`);
      runs = res.runs;
      drawList();
    } catch (err) {
      mount(list, callout('danger', 'Could not load the history', err.message));
    }
  }

  function drawList() {
    if (stopped) return;
    if (runs.length === 0) {
      const filtered = Object.values(filters).some(Boolean);
      mount(
        list,
        emptyState(
          filtered ? 'Nothing matches' : 'No tasks yet',
          filtered ? 'Try removing a filter.' : 'Run a task and it will be recorded here.',
          'search',
        ),
      );
      return;
    }
    mount(
      list,
      h(
        'ul',
        { class: 'runs' },
        runs.map((r) =>
          h(
            'li',
            null,
            h(
              'a',
              {
                class: ['run-row', r.id === openId && 'run-row--open'],
                href: `#/history/${r.id}`,
                dataset: { run: r.id },
              },
              h('span', { class: 'run-row__req' }, r.request),
              h(
                'span',
                { class: 'run-row__meta' },
                statusPill(r.status),
                tally(r.decisions),
                h(
                  'span',
                  { class: 'muted small' },
                  `${r.stepCount} ${r.stepCount === 1 ? 'step' : 'steps'} · ${timeAgo(r.createdAt)}`,
                ),
              ),
            ),
          ),
        ),
      ),
      runs.length >= limit &&
        h(
          'button',
          {
            class: 'btn btn--secondary btn--block',
            type: 'button',
            onclick: () => {
              limit += PAGE;
              load();
            },
          },
          'Show more',
        ),
    );
  }

  async function open(id) {
    mount(detailBox, h('p', { class: 'muted' }, 'Loading…'));
    try {
      mount(detailBox, detail(await api.get(`/api/runs/${id}`)));
    } catch (err) {
      mount(detailBox, callout('danger', 'Could not open that run', err.message));
    }
  }

  // Tool filter comes from the tool list.
  api
    .get('/api/rules')
    .then((r) => {
      toolSelect.replaceWith(
        select(
          'tool',
          'Used tool',
          r.tools.map((t) => [t.name, t.title]),
        ),
      );
    })
    .catch(() => {});

  if (openId) open(openId);
  else
    mount(
      detailBox,
      emptyState('Select a task', 'Its steps, decisions and reasons appear here.', 'flow'),
    );
  load();
  return () => {
    stopped = true;
    clearTimeout(debounce);
  };
}
