// Pending approvals: the state machine behind "a pending approval pauses
// execution".
//
//   pending ──resolve──▶ resolved   (one answer, exactly once)
//      │
//      └──cancelRun──▶ resolved with action "cancel"
//
// `request()` returns a promise that the policy gate awaits. The interpreter is
// therefore suspended inside that await for as long as the approval is pending,
// and nothing else in the run proceeds. Approvals live in memory only; if the
// server restarts, waiting runs are marked interrupted (docs/DECISIONS.md D10).
import { randomUUID } from 'node:crypto';

const ACTIONS = new Set([
  'approve_once',
  'approve_and_trust',
  'edit_destination',
  'reject',
  'cancel',
]);

export class ApprovalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
  }
}

export class ApprovalManager {
  #pending = new Map();
  #onChange;

  /** @param {{ onChange?: (event: object) => void }} [opts] */
  constructor({ onChange = () => {} } = {}) {
    this.#onChange = onChange;
  }

  /**
   * Register a paused action and wait for the answer.
   * @returns {Promise<{ action: string, destination?: string }>}
   */
  request({ runId, stepId, tool, card }) {
    const id = randomUUID();
    return new Promise((resolve) => {
      this.#pending.set(id, { id, runId, stepId, tool, card, createdAt: new Date(), resolve });
      this.#onChange({ type: 'approval_requested', id, runId, stepId, tool });
    });
  }

  /** Approvals waiting for an answer, optionally for one run. */
  list(runId) {
    return [...this.#pending.values()]
      .filter((p) => runId === undefined || p.runId === runId)
      .map(({ id, runId: r, stepId, tool, card, createdAt }) => ({
        id,
        runId: r,
        stepId,
        tool,
        card,
        createdAt,
      }));
  }

  get(id) {
    const p = this.#pending.get(id);
    return p
      ? { id: p.id, runId: p.runId, stepId: p.stepId, tool: p.tool, card: p.card }
      : undefined;
  }

  /**
   * Answer a pending approval. Answering twice, or an unknown id, is an error.
   * @param {string} id
   * @param {{ action: string, destination?: string }} answer
   */
  resolve(id, answer) {
    const p = this.#pending.get(id);
    if (!p) throw new ApprovalError('not_pending', 'No pending approval with that id');
    if (!ACTIONS.has(answer?.action))
      throw new ApprovalError('bad_action', 'Unknown approval action');
    if (!p.card.actions.includes(answer.action) && answer.action !== 'cancel') {
      throw new ApprovalError('action_not_offered', 'That choice is not available for this action');
    }
    if (
      answer.action === 'edit_destination' &&
      !(typeof answer.destination === 'string' && answer.destination.trim())
    ) {
      throw new ApprovalError('destination_required', 'Enter a destination');
    }
    this.#pending.delete(id);
    p.resolve({ action: answer.action, destination: answer.destination });
    this.#onChange({ type: 'approval_resolved', id, runId: p.runId, action: answer.action });
  }

  /** Drop every pending approval of a run. The run's gate sees a cancel and stops. */
  cancelRun(runId) {
    for (const p of [...this.#pending.values()]) {
      if (p.runId === runId) this.resolve(p.id, { action: 'cancel' });
    }
  }
}
