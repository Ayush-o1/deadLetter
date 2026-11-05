// Showing what each defence did with the same scenario.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { chip } from './chips.js';

export const DEFENCE_NAME = {
  none: 'No defence',
  session_taint: 'Session taint',
  deadletter: 'deadLetter',
  deadletter_user_approves: 'deadLetter, if you approve every prompt',
};

const ATTACK = {
  succeeded: ['Attack succeeded', 'deny'],
  blocked: ['Blocked', 'allow'],
  escalated: ['Asked you; you rejected', 'ask'],
  no_path: ['Nothing for the attack to trigger', 'allow'],
};

const REASON = {
  guard_blocked: 'a tool was blocked by the session-taint rule',
  cannot_plan: 'the task cannot be planned in advance',
  goal_not_reached: 'it did not reach its goal',
  rejected: 'the action was rejected',
  denied: 'the policy denied an action',
  tool_error: 'a tool failed',
  quarantine_failed: 'the quarantined model failed',
  quarantine_output_invalid: 'the model returned an invalid value',
};

const ACTION = {
  executed: ['ran', 'check', 'ok'],
  asked_approved: ['ran after you approved', 'check', 'ok'],
  denied: ['denied by the policy', 'x', 'bad'],
  blocked: ['blocked by the guard', 'x', 'bad'],
  asked_rejected: ['you rejected it', 'alert', 'ask'],
  failed: ['failed', 'x', 'bad'],
};

export const signature = (t) => `${t.tool}→${t.target ?? ''}`;

/** The headline outcome of one run, as a pill with a short reason. */
export function outcome(run) {
  if (run.kind === 'attack') {
    const [label, tone] = ATTACK[run.attackOutcome];
    return h(
      'div',
      { class: 'outcome' },
      h('span', { class: ['pill', `pill--${tone}`] }, label),
      run.leaks.length > 0 && chip('private data left', 'deny', 'lock'),
    );
  }
  const prompts = run.asks > 0 ? ` (${run.asks} prompt${run.asks > 1 ? 's' : ''})` : '';
  return run.completed
    ? h(
        'div',
        { class: 'outcome' },
        h('span', { class: 'pill pill--allow' }, `Completed${prompts}`),
      )
    : h(
        'div',
        { class: 'outcome' },
        h('span', { class: 'pill pill--deny' }, 'Did not complete'),
        h(
          'p',
          { class: 'small muted' },
          `Because ${REASON[run.failureReason] ?? run.failureReason}.`,
        ),
      );
}

/**
 * What the defence let happen, in order. `extra` lists actions that only the attacked
 * run contains (one entry per surplus occurrence); the LAST matching occurrences are
 * marked, so a legitimate earlier "read email" is not flagged along with the surplus one.
 */
export function actions(run, extra = []) {
  if (run.trace.length === 0) {
    return h(
      'p',
      { class: 'small muted' },
      run.status === 'plan_failed'
        ? 'It could not make a plan, so no tool was used.'
        : 'No tool was used.',
    );
  }
  const remaining = new Map();
  for (const sig of extra) remaining.set(sig, (remaining.get(sig) ?? 0) + 1);
  const marked = new Set();
  for (let i = run.trace.length - 1; i >= 0; i--) {
    const t = run.trace[i];
    const ran = t.outcome === 'executed' || t.outcome === 'asked_approved';
    if (ran && (remaining.get(signature(t)) ?? 0) > 0) {
      marked.add(i);
      remaining.set(signature(t), remaining.get(signature(t)) - 1);
    }
  }
  return h(
    'ol',
    { class: 'acts' },
    run.trace.map((t, i) => {
      const [text, ico, tone] = ACTION[t.outcome] ?? [t.outcome, 'info', 'ok'];
      return h(
        'li',
        { class: ['act', `act--${tone}`, marked.has(i) && 'act--extra'] },
        icon(ico, 14),
        h(
          'span',
          { class: 'act__main' },
          h('strong', null, t.tool.replace(/_/g, ' ')),
          t.target && h('span', { class: 'mono act__target' }, ` → ${t.target}`),
        ),
        h('span', { class: 'act__state small' }, text, t.rule && ` · ${t.rule.replace(/_/g, ' ')}`),
        marked.has(i) && chip('only in the attacked run', 'deny'),
      );
    }),
  );
}

/** One card per defence, side by side. */
export function comparison(runs) {
  const keys = Object.keys(runs);
  return h(
    'div',
    { class: ['compare', `compare--${keys.length}`] },
    keys.map((key) =>
      h(
        'section',
        { class: 'compare__col card', dataset: { defence: key } },
        h('h3', null, DEFENCE_NAME[key]),
        outcome(runs[key]),
        h('h4', { class: 'compare__sub' }, 'What it did'),
        actions(runs[key]),
        runs[key].leaks.length > 0 &&
          h(
            'p',
            { class: 'small compare__leak' },
            icon('lock', 13),
            ` Private data reached ${[...new Set(runs[key].leaks.map((l) => l.target))].join(', ')}.`,
          ),
      ),
    ),
  );
}

/** Clean run beside attacked run, with what only the attack caused. */
export function diffView(result) {
  return h(
    'div',
    { class: 'stack' },
    result.diff.identical
      ? h(
          'div',
          { class: 'callout callout--ok' },
          icon('check', 18),
          h(
            'div',
            { class: 'callout__body' },
            h('strong', null, 'Identical actions'),
            'The attack changed no tool call or destination. Text derived from the content, such as a summary, can differ and is not compared.',
          ),
        )
      : h(
          'div',
          { class: 'callout callout--danger' },
          icon('alert', 18),
          h(
            'div',
            { class: 'callout__body' },
            h(
              'strong',
              null,
              `${result.diff.extraInAttacked.length} extra action${result.diff.extraInAttacked.length === 1 ? '' : 's'} caused by the attack`,
            ),
            result.diff.extraInAttacked.join(', '),
          ),
        ),
    h(
      'div',
      { class: 'diff' },
      h(
        'section',
        { class: 'card' },
        h('h3', null, 'Clean: the same task, no attack'),
        outcome(result.clean),
        actions(result.clean),
      ),
      h(
        'section',
        { class: 'card' },
        h('h3', null, 'Attacked: the attacker’s text is in place'),
        outcome(result.attacked),
        actions(result.attacked, result.diff.extraInAttacked),
      ),
    ),
  );
}
