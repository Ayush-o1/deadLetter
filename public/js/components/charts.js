// Horizontal bar charts for the evaluation dashboard, drawn as plain SVG.
//
// Chart rules followed here: one axis; thin bars with a rounded data end anchored
// to the baseline; a recessive grid; every bar carries a direct label (value and
// the count behind it, so a percentage is never shown without its denominator);
// text uses ink colour, never the series colour; the series colours are the
// validated colour-blind-safe set from tokens.css; the "user approves everything"
// bar also has a hatched texture so it is never distinguished by colour alone;
// and every chart can be switched to a table.
import { h, svg } from '../dom.js';

const ROW = 46;
const LEFT = 214;
const RIGHT = 130;
const W = 760;
const BAR = 16;
const TOP = 22;

/**
 * @param {object} spec
 * @param {string} spec.title
 * @param {string} spec.caption             what the numbers count
 * @param {string} spec.better              e.g. "Lower is better"
 * @param {{ label: string, value: number | null, count: number, total: number, series: string, hatched?: boolean, note?: string }[]} spec.rows
 */
export function barChart({ title, caption, better, rows }) {
  const height = TOP + rows.length * ROW + 24;
  const plot = W - LEFT - RIGHT;
  const x = (pct) => LEFT + (plot * pct) / 100;

  const grid = [0, 25, 50, 75, 100].map((p) => [
    svg('line', {
      x1: x(p),
      y1: TOP - 6,
      x2: x(p),
      y2: height - 24,
      class: p === 0 ? 'chart__axis' : 'chart__grid',
    }),
    svg('text', { x: x(p), y: height - 8, class: 'chart__tick', 'text-anchor': 'middle' }, `${p}%`),
  ]);

  const bars = rows.map((row, i) => {
    const y = TOP + i * ROW;
    const cy = y + ROW / 2 - 2;
    const w = row.value === null ? 0 : Math.max((plot * row.value) / 100, row.value > 0 ? 2 : 0);
    const g = svg('g', {
      class: 'chart__row',
      role: 'img',
      'aria-label': `${row.label}: ${row.value ?? 'n/a'}%, ${row.count} of ${row.total}`,
    });
    g.append(
      svg(
        'text',
        { x: LEFT - 14, y: cy + 4, class: 'chart__label', 'text-anchor': 'end' },
        row.label,
      ),
    );
    if (row.value !== null) {
      // Rounded at the data end only: the left end sits flat on the baseline.
      const r = Math.min(4, w / 2);
      const d = `M${x(0)} ${cy - BAR / 2} H${x(0) + w - r} Q${x(0) + w} ${cy - BAR / 2} ${x(0) + w} ${cy - BAR / 2 + r} V${cy + BAR / 2 - r} Q${x(0) + w} ${cy + BAR / 2} ${x(0) + w - r} ${cy + BAR / 2} H${x(0)} Z`;
      g.append(svg('path', { d, class: `chart__bar chart__bar--${row.series}` }));
      if (row.hatched) g.append(svg('path', { d, class: 'chart__hatch' }));
      g.append(svg('title', null, `${row.label}: ${row.value}% (${row.count} of ${row.total})`));
    }
    // Value and count are ONE text run, so they can never overlap whatever the digits are.
    const text = svg(
      'text',
      { x: x(0) + w + 10, y: cy + 5, class: 'chart__value' },
      row.value === null ? 'n/a' : `${row.value}%`,
    );
    if (row.value !== null) {
      text.append(svg('tspan', { class: 'chart__count', dx: 8 }, `${row.count} of ${row.total}`));
    }
    g.append(text);
    return g;
  });

  const defs = svg(
    'defs',
    null,
    svg(
      'pattern',
      { id: 'hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', transform: 'rotate(45)' },
      svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'chart__hatch-line' }),
    ),
  );
  const graphic = svg(
    'svg',
    { class: 'chart__svg', viewBox: `0 0 ${W} ${height}`, role: 'group', 'aria-label': title },
    defs,
    ...grid,
    ...bars,
  );

  const table = h(
    'table',
    { class: 'chart__table', hidden: true },
    h('caption', { class: 'sr-only' }, title),
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', { scope: 'col' }, 'Defence'),
        h('th', { scope: 'col' }, 'Rate'),
        h('th', { scope: 'col' }, 'Count'),
      ),
    ),
    h(
      'tbody',
      null,
      rows.map((r) =>
        h(
          'tr',
          null,
          h('th', { scope: 'row' }, r.label),
          h('td', null, r.value === null ? 'n/a' : `${r.value}%`),
          h('td', null, r.value === null ? '' : `${r.count} of ${r.total}`),
        ),
      ),
    ),
  );
  const toggle = h(
    'button',
    {
      class: 'link-btn',
      type: 'button',
      'aria-pressed': 'false',
      onclick: () => {
        const showTable = table.hidden;
        table.hidden = !showTable;
        graphic.style.display = showTable ? 'none' : '';
        toggle.textContent = showTable ? 'Show as chart' : 'Show as table';
        toggle.setAttribute('aria-pressed', String(showTable));
      },
    },
    'Show as table',
  );

  return h(
    'figure',
    { class: 'chart' },
    h(
      'figcaption',
      { class: 'chart__head' },
      h('h3', null, title),
      h('p', { class: 'muted small chart__caption' }, caption),
      h('div', { class: 'chart__meta' }, h('span', { class: 'chart__better' }, better), toggle),
    ),
    graphic,
    table,
  );
}
