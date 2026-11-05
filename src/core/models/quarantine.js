// The quarantined model interface: reads untrusted text, does one narrow job,
// returns a bare value. It has no tools, no run state, no secrets.
//
// The provider is handed a frozen object with exactly four keys. What it returns
// is NOT trusted: the interpreter checks it against the requested type and
// labels it untrusted.
import { z } from 'zod';
import { QUARANTINE_OUTPUTS, QUARANTINE_TASKS } from '../plan/schema.js';

const jobSchema = z.strictObject({
  task: z.enum(QUARANTINE_TASKS),
  instruction: z.string().max(300).optional(),
  output: z.enum(QUARANTINE_OUTPUTS),
  content: z.string().max(50_000),
});

/**
 * @param {{ provider: { extract: (job: object) => Promise<unknown> } }} deps
 * @returns {(job: object) => Promise<unknown>}
 */
export function createQuarantine({ provider }) {
  return async function quarantine(job) {
    const parsed = jobSchema.parse(job); // throws on anything unexpected
    return provider.extract(
      Object.freeze({
        task: parsed.task,
        instruction: parsed.instruction,
        output: parsed.output,
        content: parsed.content,
      }),
    );
  };
}
