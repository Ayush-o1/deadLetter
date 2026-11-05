// The Run screen: task and plan on the left, the live trace in the middle, and
// any decision waiting for you on the right.
import { ApiError, api } from '../api.js';
import { approvalCard } from '../components/approvalCard.js';
import { callout, chip, emptyState, labelChips, statusPill } from '../components/chips.js';
import { openFlow } from '../components/flowGraph.js';
import { planPreview } from '../components/planPreview.js';
import { trace } from '../components/trace.js';
import { h, mount } from '../dom.js';
import { ACTIVE, FINISHED } from '../format.js';
import { icon } from '../icons.js';

const POLL_MS = 350;

function explainer() {
  const item = (n, title, text) =>
    h(
      'li',
      null,
      h('span', { class: 'explainer__n' }, n),
      h('div', null, h('strong', null, title), h('p', { class: 'muted' }, text)),
    );
  return h(
    'section',
    { class: 'card explainer' },
    h('h2', null, 'How a task is handled'),
    h(
      'ol',
      { class: 'explainer__list' },
      item(
        '1',
        'A plan is written from your words only',
        'The planner never sees an email, file or web page, so text inside them cannot change what the plan does.',
      ),
      item(
        '2',
        'Outside text is read by a model that has no tools',
        'It can only hand back a value, and that value is marked untrusted.',
      ),
      item(
        '3',
        'Every tool action meets the rules first',
        'Allow runs it. Deny refuses it. Ask pauses and puts it to you.',
      ),
      item(
        '4',
        'Every step is recorded with the reason',
        'Open “Why?” on any step to see which value triggered which rule.',
      ),
    ),
    h(
      'div',
      { class: 'explainer__legend' },
      h('span', { class: 'small muted' }, 'Labels you will see on values:'),
      chip('Trusted', 'trusted', 'shield'),
      chip('Untrusted', 'untrusted', 'alert'),
      chip('Private · only you', 'private', 'lock'),
    ),
  );
}

function resultCard(result) {
  return h(
    'article',
    { class: 'result' },
    h(
      'header',
      { class: 'result__head' },
      h('h3', null, result.title ?? 'Result'),
      labelChips(result.label),
    ),
    h('pre', { class: 'result__text' }, result.text ?? result.preview),
    result.text === undefined &&
      result.truncated &&
      h(
        'p',
        { class: 'small muted' },
        'Only a short preview is kept in the history; the full text is not stored.',
      ),
    h(
      'p',
      { class: 'small muted' },
      'Shown as plain text. Links and markup inside it are not active.',
    ),
  );
}

function finalBanner(run) {
  const decided = run.steps.filter((s) => s.policy);
  const byUser = decided.filter((s) => s.policy.decidedBy === 'user').length;
  const denied = decided.filter((s) => s.policy.decision === 'deny').length;
  const summary = `${run.steps.filter((s) => s.state === 'done').length} steps done · ${decided.filter((s) => s.policy.decision === 'allow').length} allowed by the rules · ${byUser} decided by you · ${denied} denied`;
  switch (run.status) {
    case 'completed':
      return callout('ok', 'Done', summary);
    case 'blocked':
      return callout(
        'danger',
        'Stopped before the action',
        run.error?.message ?? 'An action was not allowed.',
        h('br'),
        'The blocked step did not run, and the steps after it were skipped. ',
        summary,
      );
    case 'failed':
      return callout(
        'danger',
        'The task failed',
        run.error?.message ?? 'Something went wrong.',
        h('br'),
        summary,
      );
    case 'cancelled':
      return callout(
        'info',
        'Cancelled',
        'No new step started. Steps that had already finished stay finished (an email already sent cannot be unsent).',
      );
    case 'interrupted':
      return callout('info', 'Interrupted', 'The server restarted while this task was running.');
    default:
      return null;
  }
}

export function renderRun(root, { param: initialId, navigate }) {
  let run = null;
  let meta = { supportedRequests: [], modelProvider: 'mock' };
  let timer = null;
  let busy = false;
  let renderedApprovals = '';
  let stopped = false;

  const textarea = h('textarea', {
    class: 'input task__input',
    rows: 4,
    maxlength: 2000,
    placeholder: 'Describe what you want done, in plain words…',
    'aria-label': 'Your task',
    spellcheck: 'false',
  });
  const planBtn = h(
    'button',
    { class: 'btn btn--primary', type: 'button', onclick: () => makePlan() },
    icon('arrow', 15),
    'Make a plan',
  );
  const examples = h('div', { class: 'task__examples' });
  const notice = h('div', { class: 'task__notice' });
  const planBox = h('div', { class: 'plancard' });
  const mainBox = h('div', { class: 'run__trace' });
  const decisionBox = h('div', { class: 'run__decisions' });

  const left = h(
    'div',
    { class: 'run__left' },
    h(
      'section',
      { class: 'card task' },
      h('h2', null, 'Your task'),
      h(
        'p',
        { class: 'muted small' },
        'deadLetter writes a plan from these words only. You review it before anything runs.',
      ),
      textarea,
      notice,
      h('div', { class: 'row' }, planBtn),
      examples,
    ),
    planBox,
  );
  const main = h('div', { class: 'run__main' }, mainBox);
  const right = h(
    'aside',
    { class: 'run__right', 'aria-label': 'Decisions waiting for you' },
    h('h2', { class: 'run__right-title' }, 'Your decisions'),
    decisionBox,
  );
  root.append(h('div', { class: 'run' }, left, main, right));

  // ---- actions ---------------------------------------------------------------------
  async function guarded(fn) {
    if (busy) return;
    busy = true;
    planBtn.disabled = true;
    notice.replaceChildren();
    try {
      await fn();
    } catch (err) {
      notice.replaceChildren(
        callout('danger', 'That did not work', err instanceof ApiError ? err.message : String(err)),
      );
    } finally {
      busy = false;
      planBtn.disabled = false;
    }
  }

  const makePlan = () =>
    guarded(async () => {
      const request = textarea.value.trim();
      if (!request) throw new ApiError(0, { message: 'Write a task first.' });
      stopPolling();
      run = await api.post('/api/runs', { request });
      navigate(`#/run/${run.id}`, { silent: true });
      draw();
    });

  const execute = () =>
    guarded(async () => {
      run = await api.post(`/api/runs/${run.id}/execute`);
      draw();
      startPolling();
    });

  const cancel = () =>
    guarded(async () => {
      run = await api.post(`/api/runs/${run.id}/cancel`);
      draw();
    });

  async function resolve(approvalId, action, destination) {
    await api.post(`/api/approvals/${approvalId}/resolve`, {
      action,
      ...(destination ? { destination } : {}),
    });
    await refresh();
  }

  // ---- polling ---------------------------------------------------------------------
  async function refresh() {
    try {
      run = await api.get(`/api/runs/${run.id}`);
      draw();
    } catch (err) {
      notice.replaceChildren(callout('danger', 'Lost contact with the server', err.message));
      stopPolling();
      return;
    }
    if (!ACTIVE.has(run.status)) stopPolling();
  }
  function startPolling() {
    stopPolling();
    timer = setInterval(refresh, POLL_MS);
  }
  function stopPolling() {
    clearInterval(timer);
    timer = null;
  }

  // ---- drawing ---------------------------------------------------------------------
  function drawExamples() {
    if (meta.supportedRequests.length === 0) {
      mount(
        examples,
        h('p', { class: 'small muted' }, 'Using a live model: describe any task the tools can do.'),
      );
      return;
    }
    mount(
      examples,
      h(
        'details',
        { class: 'examples-box' },
        h('summary', null, `Try an example task (${meta.supportedRequests.length})`),
        h(
          'p',
          { class: 'small muted' },
          'Demo mode only understands these shapes. A live model can plan any task.',
        ),
        h(
          'ul',
          { class: 'examples' },
          meta.supportedRequests.map((r) =>
            h(
              'li',
              null,
              h(
                'button',
                {
                  class: 'example',
                  type: 'button',
                  onclick: () => {
                    textarea.value = r;
                    textarea.focus();
                  },
                },
                r,
              ),
            ),
          ),
        ),
      ),
    );
  }

  function drawPlan() {
    if (!run) {
      mount(
        planBox,
        h(
          'section',
          { class: 'card' },
          h('h2', null, 'Plan'),
          emptyState('No plan yet', 'The steps will appear here before anything runs.', 'flow'),
        ),
      );
      return;
    }
    if (run.status === 'failed' && !run.plan) {
      const hint =
        run.error.code === 'cannot_plan'
          ? h(
              'p',
              { class: 'small' },
              'Tasks whose steps depend on what a message says cannot be planned in advance. That is the price of keeping instructions and data apart.',
            )
          : null;
      mount(
        planBox,
        h(
          'section',
          { class: 'card' },
          h('h2', null, 'Plan'),
          callout('danger', 'No plan was made', run.error.message),
          hint,
        ),
      );
      return;
    }
    const ready = run.status === 'planned';
    mount(
      planBox,
      h(
        'section',
        { class: 'card plan-card' },
        h(
          'div',
          { class: 'row' },
          h('h2', null, 'Plan'),
          h('span', { class: 'spacer' }),
          ready && statusPill(run.status),
        ),
        h(
          'p',
          { class: 'muted small' },
          'Written from your request alone. It never saw an email, file or web page.',
        ),
        planPreview(run.planPreview),
        ready &&
          h(
            'div',
            { class: 'row plan-card__actions' },
            h(
              'button',
              {
                class: 'btn btn--primary',
                type: 'button',
                onclick: execute,
                dataset: { action: 'run' },
              },
              icon('play', 14),
              'Run plan',
            ),
            h(
              'button',
              { class: 'btn btn--secondary', type: 'button', onclick: cancel },
              'Discard',
            ),
          ),
      ),
    );
  }

  function drawMain() {
    if (!run || run.status === 'planned' || (run.status === 'failed' && !run.plan)) {
      mount(
        mainBox,
        run?.status === 'planned'
          ? h(
              'div',
              { class: 'stack' },
              callout(
                'info',
                'Review the plan, then run it',
                'Nothing has happened yet. No tool has been touched.',
              ),
              explainer(),
            )
          : explainer(),
      );
      return;
    }
    const active = ACTIVE.has(run.status);
    mount(
      mainBox,
      h(
        'div',
        { class: 'stack' },
        h(
          'section',
          { class: 'card' },
          h(
            'div',
            { class: 'row trace__head' },
            h('h2', null, 'What is happening'),
            statusPill(run.status),
            h('span', { class: 'spacer' }),
            active &&
              h(
                'button',
                { class: 'btn btn--secondary btn--sm', type: 'button', onclick: cancel },
                icon('stop', 13),
                'Cancel',
              ),
          ),
          trace(run, { onTrace: (step) => openFlow(run.id, step) }),
        ),
        run.results.length > 0 &&
          h(
            'section',
            { class: 'card' },
            h('h2', null, 'Result'),
            h('div', { class: 'stack' }, run.results.map(resultCard)),
          ),
        FINISHED.has(run.status) && finalBanner(run),
      ),
    );
  }

  function drawDecisions() {
    const pending = run?.pendingApprovals ?? [];
    const signature = pending.map((p) => p.id).join(',');
    if (signature === renderedApprovals && signature !== '') return; // keep what you typed in a card
    renderedApprovals = signature;
    // Tell the header at once, so its count of waiting decisions is never stale.
    window.dispatchEvent(new CustomEvent('dl-refresh'));
    // On narrow screens the panel sits above the task, so it only shows when there is something to decide.
    right.classList.toggle('run__right--idle', pending.length === 0);
    if (pending.length === 0) {
      mount(
        decisionBox,
        emptyState(
          'Nothing is waiting for you',
          'When a step needs a decision, a card appears here and the run waits.',
          'check',
        ),
        h(
          'div',
          { class: 'card decide-legend' },
          h('h3', null, 'The three decisions'),
          h(
            'ul',
            null,
            h(
              'li',
              null,
              h('span', { class: 'badge badge--allow' }, 'Allow'),
              h('span', null, 'The step runs.'),
            ),
            h(
              'li',
              null,
              h('span', { class: 'badge badge--ask' }, 'Ask'),
              h('span', null, 'The run pauses and you decide.'),
            ),
            h(
              'li',
              null,
              h('span', { class: 'badge badge--deny' }, 'Deny'),
              h('span', null, 'The step does not run.'),
            ),
          ),
        ),
      );
      return;
    }
    mount(
      decisionBox,
      ...pending.map((p) =>
        approvalCard(p, { onResolve: (action, dest) => resolve(p.id, action, dest) }),
      ),
    );
  }

  function draw() {
    if (stopped) return;
    drawPlan();
    drawMain();
    drawDecisions();
  }

  // ---- start -------------------------------------------------------------------------
  drawExamples();
  draw();
  api
    .get('/api/meta')
    .then((m) => {
      meta = m;
      drawExamples();
    })
    .catch(() => {});
  if (initialId) {
    api
      .get(`/api/runs/${initialId}`)
      .then((r) => {
        run = r;
        textarea.value = r.request;
        draw();
        if (ACTIVE.has(r.status)) startPolling();
      })
      .catch((err) =>
        notice.replaceChildren(callout('danger', 'Could not open that run', err.message)),
      );
  }

  return () => {
    stopped = true;
    stopPolling();
  };
}
