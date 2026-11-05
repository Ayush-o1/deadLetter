// How a run stops early. Thrown inside the interpreter, caught once in runPlan.

export class RunHalt extends Error {
  /**
   * @param {'failed' | 'blocked' | 'cancelled'} status
   * @param {string} code short machine-readable reason
   * @param {string} message safe to show to the user
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'RunHalt';
    this.status = status;
    this.code = code;
  }
}

export const fail = (code, message) => new RunHalt('failed', code, message);
