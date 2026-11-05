// An in-memory run repository, for tests and for running without a database.
// It implements the same interface as the Prisma repository (src/db/), and the
// same contract test runs against both.
//
// `history` keeps every saved version as JSON text so tests can scan everything
// that was ever written for private content.
import { normalizeFilters, runMatches, summarizeRun } from './summary.js';

export class InMemoryRunRepository {
  #runs = new Map();
  #steps = new Map();
  history = [];
  /** Set to make writes fail, to test fail-closed behaviour. */
  failWhen = null;

  #check(kind, payload) {
    if (this.failWhen?.(kind, payload)) throw new Error('storage unavailable');
  }

  #stepsOf(id) {
    return [...(this.#steps.get(id)?.values() ?? [])].sort((a, b) => a.seq - b.seq);
  }

  async saveRun(run) {
    this.#check('run', run);
    this.#runs.set(run.id, structuredClone(run));
    this.history.push(JSON.stringify(run));
  }

  async saveStep(runId, step) {
    this.#check('step', step);
    const steps = this.#steps.get(runId) ?? new Map();
    steps.set(step.seq, structuredClone(step));
    this.#steps.set(runId, steps);
    this.history.push(JSON.stringify(step));
  }

  async getRun(id) {
    const run = this.#runs.get(id);
    return run ? structuredClone({ ...run, steps: this.#stepsOf(id) }) : undefined;
  }

  /** @param {import('./summary.js').RunFilters} [filters] */
  async listRuns(filters) {
    const f = normalizeFilters(filters);
    return [...this.#runs.values()]
      .filter((run) => runMatches(run, this.#stepsOf(run.id), f))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(f.offset, f.offset + f.limit)
      .map((run) => summarizeRun(run, this.#stepsOf(run.id)));
  }

  async listByStatus(statuses) {
    return [...this.#runs.values()]
      .filter((r) => statuses.includes(r.status))
      .map((run) => summarizeRun(run, this.#stepsOf(run.id)));
  }
}
