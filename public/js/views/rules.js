// The Rules screen: which tools exist, what each does, and who is trusted.
import { ApiError, api } from '../api.js';
import { callout, chip, emptyState } from '../components/chips.js';
import { h, mount } from '../dom.js';
import { icon } from '../icons.js';

const EFFECT = {
  read: ['Reads', 'plain'],
  send: ['Sends data out', 'untrusted'],
  destructive: ['Changes or deletes', 'deny'],
};
const ROLE_NOTE = {
  destination: 'where data goes',
  selector: 'what to act on',
  data: 'content',
  plain: 'text',
};

// One line per template for the tool rows; the full wording is in the templates card.
const SHORT = {
  allow: 'Runs without asking. The always-on rules still apply.',
  ask: 'Pauses and asks you every time.',
  deny: 'Never runs.',
  trusted_destination:
    'Runs if the destination is one you named or trust; asks if private data would go somewhere it may not.',
};

const FLOOR = [
  [
    'Untrusted text cannot choose a destination',
    'If an address or URL came from an email, file or web page, the action asks you, and is denied outright when private data would go with it.',
  ],
  [
    'Untrusted text cannot choose what to read, look up or delete',
    'A file name or contact name taken from outside text always asks.',
  ],
  [
    'A condition that depends on untrusted text cannot act silently',
    'Anything inside an “if” or loop whose condition came from outside text asks.',
  ],
  [
    'An unknown tool is denied; a tool with no rule asks',
    'Missing configuration never turns into permission.',
  ],
];

export function renderRules(root) {
  const page = h('div', { class: 'page rules' });
  root.append(page);
  let data;

  async function load() {
    try {
      data = await api.get('/api/rules');
      draw();
    } catch (err) {
      mount(page, callout('danger', 'Could not load the rules', err.message));
    }
  }

  function saved(cell) {
    const ok = h('span', { class: 'saved' }, icon('check', 13), 'Saved');
    cell.append(ok);
    setTimeout(() => ok.remove(), 1600);
  }

  async function save(tool, patch, cell) {
    try {
      await api.put(`/api/rules/tools/${tool.name}`, {
        enabled: tool.enabled ?? true,
        template: tool.template ?? 'ask',
        ...patch,
      });
      Object.assign(tool, patch, { configured: true });
      draw();
      saved(page.querySelector(`[data-tool="${tool.name}"] .rule__saved`));
    } catch (err) {
      cell.append(h('span', { class: 'field-error' }, err.message));
    }
  }

  function toolRow(tool) {
    const [effectLabel, effectTone] = EFFECT[tool.effect];
    const select = h(
      'select',
      {
        class: 'input select',
        'aria-label': `Rule for ${tool.title}`,
        onchange: (e) => save(tool, { template: e.target.value }, savedCell),
      },
      !tool.configured && h('option', { value: '', selected: true }, 'No rule: asks every time'),
      Object.entries(data.templates).map(([key, t]) =>
        h('option', { value: key, selected: tool.template === key }, t.title),
      ),
    );
    const toggle = h(
      'label',
      { class: 'switch' },
      h('input', {
        type: 'checkbox',
        checked: tool.enabled === true,
        onchange: (e) => save(tool, { enabled: e.target.checked }, savedCell),
        'aria-label': `${tool.title} is on`,
      }),
      h('span', { class: 'switch__track' }),
      h('span', { class: 'sr-only' }, 'On'),
    );
    const savedCell = h('span', { class: 'rule__saved' });
    return h(
      'li',
      { class: ['rule', tool.enabled === false && 'rule--off'], dataset: { tool: tool.name } },
      h(
        'div',
        { class: 'rule__id' },
        h(
          'div',
          { class: 'row wrap' },
          h('h3', null, tool.title),
          chip(effectLabel, effectTone),
          !tool.configured && chip('no rule', 'ask', 'alert'),
        ),
        h('p', { class: 'mono small muted' }, tool.name),
        h(
          'p',
          { class: 'small muted' },
          'Takes: ',
          Object.entries(tool.params)
            .map(([n, p]) => `${n} (${ROLE_NOTE[p.role]})`)
            .join(', '),
        ),
      ),
      h(
        'div',
        { class: 'rule__controls' },
        h('div', { class: 'rule__row' }, toggle, select, savedCell),
        tool.configured && h('p', { class: 'small muted' }, SHORT[tool.template]),
      ),
    );
  }

  function trustedSection() {
    const input = h('input', {
      class: 'input',
      type: 'text',
      placeholder: 'name@example.com or https://example.org',
      'aria-label': 'Destination to trust',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    const error = h('p', { class: 'field-error', hidden: true });
    const add = async () => {
      try {
        await api.post('/api/rules/trusted', { destination: input.value });
        await load();
      } catch (err) {
        error.textContent =
          err instanceof ApiError && err.details
            ? 'Enter an address or URL (at least 3 characters).'
            : err.message;
        error.hidden = false;
      }
    };
    return h(
      'section',
      { class: 'card' },
      h('h2', null, 'Trusted destinations'),
      h(
        'p',
        { class: 'muted small' },
        'Addresses you trust skip the question when text from outside suggested them. Private data still asks unless you named the recipient in your request. “Send and trust” on an approval card adds to this list.',
      ),
      data.trustedDestinations.length === 0
        ? emptyState(
            'Nobody is trusted yet',
            'Your contacts and any address you type in a request are already trusted for that task.',
            'user',
          )
        : h(
            'ul',
            { class: 'trusted' },
            data.trustedDestinations.map((t) =>
              h(
                'li',
                null,
                h('span', { class: 'mono' }, t.destination),
                h(
                  'button',
                  {
                    class: 'link-btn',
                    type: 'button',
                    onclick: async () => {
                      await api.delete('/api/rules/trusted', { destination: t.destination });
                      await load();
                    },
                  },
                  icon('trash', 14),
                  'Remove',
                ),
              ),
            ),
          ),
      h(
        'form',
        {
          class: 'row trusted__add',
          onsubmit: (e) => {
            e.preventDefault();
            add();
          },
        },
        input,
        h('button', { class: 'btn btn--secondary', type: 'submit' }, icon('plus', 14), 'Trust'),
      ),
      error,
    );
  }

  function draw() {
    mount(
      page,
      h(
        'header',
        { class: 'page__head' },
        h('h1', null, 'Rules'),
        h(
          'p',
          { class: 'muted' },
          'Choose which tools the agent may use and how each one is checked. Changes apply to the next action.',
        ),
      ),
      h(
        'div',
        { class: 'rules__grid' },
        h(
          'div',
          { class: 'stack' },
          h(
            'section',
            { class: 'card' },
            h('h2', null, 'Tools'),
            h('ul', { class: 'rules__list' }, data.tools.map(toolRow)),
          ),
          trustedSection(),
        ),
        h(
          'aside',
          { class: 'stack' },
          h(
            'section',
            { class: 'card floor' },
            h('h2', null, icon('shield', 16), 'Always on'),
            h(
              'p',
              { class: 'muted small' },
              'These hold for every tool and cannot be turned off here. Your per-tool choice can only make a tool stricter than this.',
            ),
            h(
              'ul',
              null,
              FLOOR.map(([t, d]) =>
                h('li', null, h('strong', null, t), h('p', { class: 'small muted' }, d)),
              ),
            ),
          ),
          h(
            'section',
            { class: 'card' },
            h('h2', null, 'Rule templates'),
            h(
              'dl',
              { class: 'templates' },
              Object.values(data.templates).flatMap((t) => [
                h('dt', null, t.title),
                h('dd', { class: 'small muted' }, t.description),
              ]),
            ),
          ),
        ),
      ),
    );
  }

  load();
  return () => {};
}
