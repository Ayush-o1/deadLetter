// The plan as plain steps, shown BEFORE anything runs.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { chip } from './chips.js';

const KIND_ICON = {
  call: 'bolt',
  quarantine: 'quarantine',
  show: 'eye',
  if: 'branch',
  else: 'branch',
  for_each: 'loop',
};

export function planPreview(lines) {
  return h(
    'ol',
    { class: 'plan' },
    lines.map((line, i) =>
      h(
        'li',
        {
          class: ['plan__line', `plan__line--${line.kind}`],
          dataset: { depth: String(line.depth) },
        },
        h('span', { class: 'plan__no' }, String(i + 1)),
        icon(KIND_ICON[line.kind] ?? 'bolt', 15, 'icon plan__icon'),
        h('span', { class: 'plan__text' }, line.text),
        line.kind === 'quarantine' && chip('result untrusted', 'untrusted'),
        line.kind === 'call' &&
          /checked by policy/.test(line.text) &&
          chip('policy checks this', 'private', 'shield'),
      ),
    ),
  );
}
