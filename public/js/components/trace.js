// The execution trace: every step of the plan, what it used, which rule judged it,
// and why. Used by the Run screen (live) and by History (read-only).
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { STEP_STATE, clock, toolTitle } from '../format.js';
import { chip, decisionBadge, labelChips } from './chips.js';

const STATE_ICON = {
  waiting: 'clock',
  running: 'clock',
  done: 'check',
  blocked: 'x',
  needs_approval: 'alert',
  failed: 'x',
  skipped: 'clock',
  interrupted: 'clock',
};

function title(step) {
  switch (step.op) {
    case 'call':
      return toolTitle(step.tool);
    case 'quarantine':
      return 'Quarantined model';
    case 'show':
      return 'Show result';
    case 'if':
      return 'Condition';
    case 'for_each':
      return 'Loop';
    default:
      return step.op;
  }
}

function argRow(arg) {
  return h(
    'li',
    { class: 'arg' },
    h('span', { class: 'arg__name' }, arg.name),
    h(
      'span',
      {
        class: 'arg__value mono',
        title: 'Short preview. Full private text is never stored in the log.',
      },
      arg.preview === '' ? '(empty)' : arg.preview,
    ),
    labelChips(arg.label),
  );
}

function policyBlock(step, onTrace) {
  const p = step.policy;
  const reasons = h(
    'div',
    { class: 'why', hidden: true },
    h('p', { class: 'why__headline' }, p.explanation.headline),
    p.explanation.reasons.length > 0 &&
      h(
        'ul',
        { class: 'why__reasons' },
        p.explanation.reasons.map((r) => h('li', null, r)),
      ),
    h('p', { class: 'small' }, h('strong', null, 'Rule: '), p.explanation.rule),
    p.explanation.next.length > 0 &&
      h(
        'div',
        { class: 'small' },
        h('strong', null, 'What you can do'),
        h(
          'ul',
          { class: 'why__next' },
          p.explanation.next.map((n) => h('li', null, n)),
        ),
      ),
  );
  const toggle = h(
    'button',
    {
      class: 'link-btn',
      type: 'button',
      'aria-expanded': 'false',
      onclick: () => {
        reasons.hidden = !reasons.hidden;
        toggle.setAttribute('aria-expanded', String(!reasons.hidden));
      },
    },
    icon('info', 14),
    'Why?',
  );
  const traceBtn =
    onTrace &&
    h(
      'button',
      { class: 'link-btn', type: 'button', onclick: () => onTrace(step) },
      icon('flow', 14),
      'Trace',
    );
  return h(
    'div',
    { class: ['policy', `policy--${p.decision}`] },
    h(
      'div',
      { class: 'policy__head' },
      decisionBadge(p.decision, p.decidedBy),
      p.decidedBy === 'user' &&
        p.resolution &&
        chip(`you chose: ${p.resolution.replace(/_/g, ' ')}`, 'plain'),
      p.decision !== 'allow' && p.outcome === 'blocked' && chip('did not run', 'deny'),
      h('span', { class: 'spacer' }),
      toggle,
      traceBtn,
    ),
    reasons,
  );
}

function instance(step, index, line, onTrace) {
  const detail = [];
  if (step.control.length > 0) {
    detail.push(
      h(
        'p',
        { class: 'step__note' },
        icon('branch', 14),
        'Runs because of a condition: ',
        h('span', { class: 'mono' }, step.control.map((c) => c.preview).join(', ')),
        ' ',
        labelChips(step.control[0].label, { showOrigin: false }),
      ),
    );
  }
  if (step.args.length > 0) detail.push(h('ul', { class: 'args' }, step.args.map(argRow)));
  if (step.op === 'quarantine' && step.input)
    detail.push(
      h(
        'div',
        { class: 'io' },
        h('span', { class: 'io__k' }, 'read'),
        h('span', { class: 'mono io__v' }, step.input.preview),
      ),
    );
  if (step.result && step.op !== 'call') {
    detail.push(
      h(
        'div',
        { class: 'io' },
        h(
          'span',
          { class: 'io__k' },
          step.op === 'if' ? 'condition was' : step.op === 'for_each' ? 'list' : 'produced',
        ),
        h('span', { class: 'mono io__v' }, step.result.preview),
        labelChips(step.result.label, { showOrigin: step.op === 'quarantine' }),
      ),
    );
  }
  if (step.branch)
    detail.push(h('p', { class: 'step__note' }, `Took the “${step.branch}” branch.`));
  if (step.policy) detail.push(policyBlock(step, onTrace));
  if (step.error && !step.policy?.outcome)
    detail.push(h('p', { class: 'step__error' }, step.error.message));
  else if (step.error && step.state === 'failed')
    detail.push(h('p', { class: 'step__error' }, step.error.message));

  return h(
    'li',
    { class: ['step', `step--${step.state}`], dataset: { state: step.state, step: step.stepId } },
    h(
      'span',
      { class: 'step__node', 'aria-hidden': 'true' },
      icon(STATE_ICON[step.state] ?? 'clock', 13),
    ),
    h(
      'div',
      { class: 'step__main' },
      h(
        'div',
        { class: 'step__head' },
        h('span', { class: 'step__no' }, String(index)),
        h(
          'h3',
          { class: 'step__title' },
          title(step),
          step.iteration.length > 0 &&
            h('span', { class: 'muted' }, ` · item ${step.iteration.map((i) => i + 1).join('.')}`),
        ),
        h('span', { class: ['step__state', `step__state--${step.state}`] }, STEP_STATE[step.state]),
        step.startedAt && h('span', { class: 'step__time muted small' }, clock(step.startedAt)),
      ),
      line && h('p', { class: 'step__plan muted small' }, line.text),
      ...detail,
    ),
  );
}

/**
 * @param {object} run  a run snapshot
 * @param {{ onTrace?: (step: object) => void }} [opts]
 */
export function trace(run, { onTrace } = {}) {
  const finished = !['planning', 'planned', 'running', 'awaiting_approval'].includes(run.status);
  const items = [];
  let n = 0;
  for (const line of run.planPreview) {
    if (line.kind === 'else') {
      items.push(
        h(
          'li',
          { class: 'step step--divider' },
          h('span', { class: 'step__node', 'aria-hidden': 'true' }),
          h('div', { class: 'step__main muted small' }, 'Otherwise'),
        ),
      );
      continue;
    }
    const instances = run.steps.filter((s) => s.stepId === line.id);
    n += 1;
    if (instances.length === 0) {
      const state = finished ? 'skipped' : 'waiting';
      items.push(
        instance(
          {
            op: line.kind,
            tool: null,
            iteration: [],
            control: [],
            args: [],
            state,
            stepId: line.id,
            policy: null,
            result: null,
          },
          n,
          line,
          null,
        ),
      );
      continue;
    }
    // A skipped record and real runs of the same step can coexist only for loops.
    for (const inst of instances) items.push(instance(inst, n, line, onTrace));
  }
  return h('ol', { class: 'trace', 'aria-live': 'polite' }, items);
}
