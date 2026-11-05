// Small labelled pieces that appear everywhere a value or a decision does.
// Colour always means the same thing: green trusted / orange untrusted / slate private;
// green allow / amber ask / red deny.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { DECISION, STATUS, explainLabel, readersPhrase, sourcePhrases } from '../format.js';

export function chip(text, tone, iconName, title) {
  return h(
    'span',
    { class: ['chip', `chip--${tone}`], title },
    iconName && icon(iconName, 12),
    text,
  );
}

const SOURCE_ICON = {
  email: 'mail',
  file: 'file',
  'web page': 'globe',
  contacts: 'user',
  'your request': 'user',
  'you (approval)': 'user',
  'quarantined model': 'quarantine',
};

/** Trust + privacy + where it came from, for one label. */
export function labelChips(label, { showPublic = false, showOrigin = true } = {}) {
  const trusted = label.integrity === 'trusted';
  const title = explainLabel(label);
  const out = [
    chip(
      trusted ? 'Trusted' : 'Untrusted',
      trusted ? 'trusted' : 'untrusted',
      trusted ? 'shield' : 'alert',
      title,
    ),
  ];
  if (label.readers !== 'public')
    out.push(chip(`Private · ${readersPhrase(label)}`, 'private', 'lock', title));
  else if (showPublic) out.push(chip('Anyone may receive', 'plain', null, title));
  if (showOrigin) for (const s of sourcePhrases(label)) out.push(chip(s, 'plain', SOURCE_ICON[s]));
  return h('span', { class: 'chips' }, out);
}

export function decisionBadge(decision, decidedBy) {
  const d = DECISION[decision];
  const by = decidedBy === 'user' ? 'you decided' : 'by the rules';
  return h(
    'span',
    { class: ['badge', `badge--${d.tone}`] },
    d.label,
    h('span', { class: 'badge__by' }, by),
  );
}

export function statusPill(status) {
  const s = STATUS[status] ?? { label: status, tone: 'neutral' };
  return h('span', { class: ['pill', `pill--${s.tone}`] }, s.label);
}

/** A callout box: tone is info | warn | danger | ok. */
export function callout(tone, title, ...body) {
  const ico = { info: 'info', warn: 'alert', danger: 'alert', ok: 'check' }[tone];
  return h(
    'div',
    { class: ['callout', `callout--${tone}`], role: tone === 'danger' ? 'alert' : undefined },
    icon(ico, 18),
    h('div', { class: 'callout__body' }, title && h('strong', null, title), ...body),
  );
}

export function emptyState(title, text, iconName = 'info') {
  return h(
    'div',
    { class: 'empty' },
    icon(iconName, 22),
    h('strong', null, title),
    text && h('p', { class: 'muted' }, text),
  );
}
