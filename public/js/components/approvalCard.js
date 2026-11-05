// The approval card: everything a person needs to judge ONE paused action.
// It shows the exact tool, the destination, a preview of the content, where each
// piece came from, the rule that fired, and a warning when untrusted text
// influenced a value. A pending approval pauses the run; nothing proceeds until
// one of these buttons is used.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { callout, chip } from './chips.js';

const WORDS = {
  send: { once: 'Send once', trust: 'Send and trust', go: 'Send to this address' },
  read: { once: 'Approve once', trust: 'Approve and trust', go: 'Use this address' },
  destructive: { once: 'Approve once', trust: 'Approve and trust', go: 'Use this' },
};

const ROLE_NOTE = {
  destination: 'destination',
  selector: 'chosen target',
  data: 'content',
  plain: 'text',
};

function origin(arg) {
  return h(
    'span',
    { class: ['origin', arg.trusted ? 'origin--ok' : 'origin--warn'] },
    arg.trusted ? 'From you or your contacts' : `From ${arg.origin} (untrusted)`,
  );
}

function argBlock(arg) {
  return h(
    'div',
    { class: ['acard__arg', !arg.trusted && 'acard__arg--untrusted'] },
    h(
      'div',
      { class: 'acard__arg-head' },
      h('span', { class: 'acard__arg-name' }, arg.name),
      h('span', { class: 'muted small' }, ROLE_NOTE[arg.role] ?? arg.role),
      origin(arg),
      arg.private && chip(`Private · ${arg.readers}`, 'private', 'lock'),
    ),
    h('pre', { class: 'acard__value' }, arg.preview === '' ? '(empty)' : arg.preview),
  );
}

/**
 * @param {object} pending  { id, card }
 * @param {{ onResolve: (action: string, destination?: string) => Promise<void> }} opts
 */
export function approvalCard(pending, { onResolve }) {
  const { card } = pending;
  const words = WORDS[card.tool.effect] ?? WORDS.read;
  const destArg = card.destinationArg
    ? card.arguments.find((a) => a.name === card.destinationArg)
    : null;
  let busy = false;

  const buttons = [];
  const edit = h('div', { class: 'acard__edit', hidden: true });
  const input = h('input', {
    class: 'input',
    type: 'text',
    'aria-label': 'New destination',
    placeholder: 'Type the address you want to use',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const error = h('p', { class: 'field-error', hidden: true });

  async function act(action, destination) {
    if (busy) return;
    busy = true;
    buttons.forEach((b) => (b.disabled = true));
    try {
      await onResolve(action, destination);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      busy = false;
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  const btn = (text, cls, handler, ico) => {
    const b = h(
      'button',
      { type: 'button', class: ['btn', cls], onclick: handler },
      ico && icon(ico, 15),
      text,
    );
    buttons.push(b);
    return b;
  };

  const goEdit = btn(words.go, 'btn--primary', () => {
    if (!input.value.trim()) {
      error.textContent = 'Type a destination first.';
      error.hidden = false;
      input.focus();
      return;
    }
    act('edit_destination', input.value.trim());
  });
  edit.append(
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'field__label' }, 'Send to a different destination'),
      input,
    ),
    goEdit,
  );

  const actions = [
    btn(words.once, 'btn--primary', () => act('approve_once'), 'check'),
    card.actions.includes('approve_and_trust') &&
      btn(
        destArg ? `${words.trust} ${destArg.preview}` : words.trust,
        'btn--secondary',
        () => act('approve_and_trust'),
        'shield',
      ),
    card.actions.includes('edit_destination') &&
      btn(
        'Edit destination',
        'btn--secondary',
        () => {
          edit.hidden = !edit.hidden;
          if (!edit.hidden) input.focus();
        },
        'edit',
      ),
    btn('Reject', 'btn--danger', () => act('reject'), 'x'),
  ].filter(Boolean);

  return h(
    'section',
    { class: 'acard', 'aria-labelledby': `acard-${pending.id}`, dataset: { approval: pending.id } },
    h(
      'header',
      { class: 'acard__head' },
      h('span', { class: 'acard__kicker' }, icon('alert', 14), 'Waiting for your decision'),
      h(
        'h2',
        { id: `acard-${pending.id}` },
        card.explanation.headline.replace(/^Needs your approval: /, ''),
      ),
      h('p', { class: 'muted small' }, 'The run is paused. Nothing happens until you choose.'),
    ),
    card.warnings.length > 0 &&
      callout(
        'warn',
        'Untrusted text is involved',
        h(
          'ul',
          { class: 'acard__warn-list' },
          card.warnings.map((w) => h('li', null, w)),
        ),
      ),
    h('div', { class: 'acard__args' }, card.arguments.map(argBlock)),
    h(
      'div',
      { class: 'acard__why' },
      h('h3', null, 'Why you are being asked'),
      card.explanation.reasons.length > 0 &&
        h(
          'ul',
          null,
          card.explanation.reasons.map((r) => h('li', null, r)),
        ),
      h('p', { class: 'small' }, h('strong', null, 'Rule: '), card.explanation.rule),
    ),
    error,
    h('div', { class: 'acard__actions' }, actions),
    edit,
  );
}
