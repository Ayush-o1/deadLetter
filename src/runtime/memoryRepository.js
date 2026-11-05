// An in-memory run repository, for tests and for running without a database.
// It implements the same small interface as the Prisma repository (phase 8).
// `history` keeps every saved version as JSON text so tests can scan everything
// that was ever written for private content.

export class InMemoryRunRepository {
  #runs = new Map();
  #steps = new Map();
  history = [];
  /** Set to make the next writes fail, to test fail-closed behaviour. */
  failWhen = null;

  #check(kind, payload) {
    if (this.failWhen?.(kind, payload)) throw new Error('storage unavailable');
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
    if (!run) return undefined;
    const steps = [...(this.#steps.get(id)?.values() ?? [])].sort((a, b) => a.seq - b.seq);
    return structuredClone({ ...run, steps });
  }

  async listRuns() {
    return [...this.#runs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => structuredClone(r));
  }

  async listByStatus(statuses) {
    return (await this.listRuns()).filter((r) => statuses.includes(r.status));
  }
}
