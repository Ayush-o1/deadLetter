// The information-flow explorer: for one step, where each value came from, how it
// was changed on the way (by the quarantined model, by joining text), what label it
// carries at each point, and where it ended up. One static diagram per step: no
// animation, no zoom, no editing.
import { api } from '../api.js';
import { h, mount, svg } from '../dom.js';
import { icon } from '../icons.js';
import { explainLabel, sourcePhrases, toolTitle } from '../format.js';
import { callout, labelChips } from './chips.js';

const W = 196;
const H = 64;
const GAP_X = 70;
const GAP_Y = 18;
const PAD = 16;

function nodeTitle(n) {
  if (n.origin.kind === 'literal')
    return n.origin.name === 'user_request'
      ? 'Your request'
      : n.origin.name === 'user_approval'
        ? 'You typed this'
        : 'Plan text';
  if (n.origin.kind === 'tool') return toolTitle(n.origin.name);
  if (n.origin.name.startsWith('quarantine:')) return `Quarantined: ${n.origin.name.slice(11)}`;
  if (n.origin.name === 'concat') return 'Joined text';
  if (n.origin.name === 'collect') return 'List';
  return n.origin.name;
}

const trim = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Columns by depth (sources on the left), rows ordered to keep edges short. */
export function layout(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map();
  const depthOf = (id) => {
    if (depth.has(id)) return depth.get(id);
    const n = byId.get(id);
    const deps = [...n.parents, ...n.controlDeps].filter((d) => byId.has(d));
    const d = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(depthOf));
    depth.set(id, d);
    return d;
  };
  nodes.forEach((n) => depthOf(n.id));

  const columns = [];
  for (const n of nodes) (columns[depth.get(n.id)] ??= []).push(n);
  const pos = new Map();
  columns.forEach((col, ci) => {
    if (ci > 0) {
      const mean = (n) => {
        const deps = [...n.parents, ...n.controlDeps]
          .map((d) => pos.get(d)?.y)
          .filter((y) => y !== undefined);
        return deps.length ? deps.reduce((a, b) => a + b, 0) / deps.length : 0;
      };
      col.sort((a, b) => mean(a) - mean(b));
    }
    col.forEach((n, ri) => pos.set(n.id, { x: PAD + ci * (W + GAP_X), y: PAD + ri * (H + GAP_Y) }));
  });
  const width = PAD * 2 + columns.length * W + (columns.length - 1) * GAP_X;
  const height = PAD * 2 + Math.max(...columns.map((c) => c.length)) * (H + GAP_Y) - GAP_Y;
  return { pos, width, height };
}

function diagram(graph, step, onSelect) {
  const { nodes, usedBy } = graph;
  const { pos, width, height } = layout(nodes);
  const argNames = new Map();
  for (const a of step.args ?? []) argNames.set(a.valueId, a.name);
  const edges = [];
  for (const n of nodes) {
    for (const [list, kind] of [
      [n.parents, 'data'],
      [n.controlDeps, 'control'],
    ]) {
      for (const p of list) {
        if (!pos.has(p)) continue;
        const a = pos.get(p);
        const b = pos.get(n.id);
        const x1 = a.x + W,
          y1 = a.y + H / 2,
          x2 = b.x,
          y2 = b.y + H / 2,
          mid = (x1 + x2) / 2;
        edges.push(
          svg('path', {
            d: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`,
            class: `edge edge--${kind}`,
            fill: 'none',
          }),
        );
      }
    }
  }
  const boxes = nodes.map((n) => {
    const { x, y } = pos.get(n.id);
    const trusted = n.label.integrity === 'trusted';
    const priv = n.label.readers !== 'public';
    const arg = argNames.get(n.id);
    const g = svg('g', {
      class: ['node', trusted ? 'node--trusted' : 'node--untrusted', arg && 'node--arg']
        .filter(Boolean)
        .join(' '),
      transform: `translate(${x} ${y})`,
      role: 'button',
      tabindex: 0,
      'aria-label': `${nodeTitle(n)}: ${n.preview}. ${trusted ? 'Trusted' : 'Untrusted'}${priv ? ', private' : ''}.`,
    });
    g.append(
      svg('rect', { width: W, height: H, rx: 8, class: 'node__box' }),
      svg('rect', { width: 5, height: H, rx: 2.5, class: 'node__band' }),
      svg('text', { x: 16, y: 22, class: 'node__title' }, trim(nodeTitle(n), 26)),
      svg(
        'text',
        { x: 16, y: 42, class: 'node__preview' },
        trim(n.preview === '' ? '(empty)' : n.preview, 23),
      ),
      svg(
        'text',
        { x: 16, y: 57, class: 'node__tags' },
        `${trusted ? 'trusted' : 'untrusted'}${priv ? ' · private' : ''}`,
      ),
    );
    if (arg)
      g.append(
        svg('text', { x: W - 10, y: 57, class: 'node__arg', 'text-anchor': 'end' }, `→ ${arg}`),
      );
    const select = () => onSelect(n, usedBy[n.id] ?? []);
    g.addEventListener('click', select);
    g.addEventListener(
      'keydown',
      (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), select()),
    );
    return g;
  });
  return svg(
    'svg',
    {
      class: 'flow__svg',
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      // A group, not an image: the boxes inside are focusable buttons, and a screen reader
      // treats everything inside role="img" as non-interactive.
      role: 'group',
      'aria-label': 'Diagram of where each value came from',
    },
    ...edges,
    ...boxes,
  );
}

function detail(n, uses) {
  return h(
    'div',
    { class: 'flow__detail' },
    h('h3', null, nodeTitle(n)),
    h('p', { class: 'mono flow__preview' }, n.preview === '' ? '(empty)' : n.preview),
    labelChips(n.label, { showPublic: true }),
    h('p', { class: 'small' }, explainLabel(n.label)),
    sourcePhrases(n.label).length > 0 &&
      h('p', { class: 'small muted' }, `Made from or using: ${sourcePhrases(n.label).join(', ')}.`),
    n.controlDeps.length > 0 &&
      h(
        'p',
        { class: 'small' },
        icon('branch', 14),
        ' Exists only because of an earlier condition, so it inherits that condition’s label.',
      ),
    uses.length > 0 &&
      h(
        'p',
        { class: 'small' },
        h('strong', null, 'Reached: '),
        uses.map((u) => `${toolTitle(u.tool)} → ${u.arg}`).join(', '),
      ),
  );
}

/** Open the explorer for one step of a run. */
export async function openFlow(runId, step) {
  const previouslyFocused = document.activeElement;
  const body = h('div', { class: 'flow__body' }, h('p', { class: 'muted' }, 'Loading…'));
  const side = h(
    'aside',
    { class: 'flow__side' },
    h('p', { class: 'muted small' }, 'Select a box to see its label in words.'),
  );
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    previouslyFocused?.focus?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const overlay = h(
    'div',
    { class: 'overlay', onclick: (e) => e.target === overlay && close() },
    h(
      'section',
      {
        class: 'flow',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Where did this value come from?',
      },
      h(
        'header',
        { class: 'flow__head' },
        h(
          'div',
          null,
          h('h2', null, 'Where did this come from?'),
          h(
            'p',
            { class: 'muted small' },
            `${toolTitle(step.tool ?? step.op)} · step ${step.stepId}`,
          ),
        ),
        h(
          'button',
          { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close },
          icon('x', 16),
        ),
      ),
      h(
        'div',
        { class: 'flow__legend small' },
        h('span', null, h('i', { class: 'swatch swatch--trusted' }), 'trusted'),
        h('span', null, h('i', { class: 'swatch swatch--untrusted' }), 'untrusted'),
        h('span', null, h('i', { class: 'swatch swatch--line' }), 'made from'),
        h('span', null, h('i', { class: 'swatch swatch--dash' }), 'depends on a condition'),
        h('span', { class: 'muted' }, 'Left to right: sources → changes → what reached the tool.'),
      ),
      h('div', { class: 'flow__layout' }, body, side),
    ),
  );
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.icon-btn').focus();

  try {
    const graph = await api.get(`/api/runs/${runId}/graph?step=${step.seq}`);
    if (graph.nodes.length === 0) {
      mount(body, callout('info', 'Nothing to trace', 'This step did not use any tracked values.'));
      return;
    }
    mount(
      body,
      diagram(graph, step, (n, uses) => mount(side, detail(n, uses))),
    );
  } catch (err) {
    mount(body, callout('danger', 'Could not load the trace', err.message));
  }
}
