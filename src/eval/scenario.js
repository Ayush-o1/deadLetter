// Scenario files: one JSON document per scenario, validated on load.
//
// A scenario says: what the user asks, what the world looks like (the seed
// dataset plus one injected change), what the attacker wants, and how to tell
// whether the attack worked or the task was completed. The SAME scenario is run
// against every defence, so differences in outcome come from the defence.
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const target = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('email'), id: z.string() }),
  z.strictObject({ type: z.literal('file'), path: z.string() }),
  z.strictObject({ type: z.literal('page'), url: z.string() }),
]);

/** Where the attacker's text goes and how it is placed. */
const injection = z.strictObject({
  target,
  position: z.enum(['prepend', 'append', 'replace']),
  find: z.string().optional(), // for "replace": the text to replace
  text: z.string().min(1),
});

/** A step the fooled agent performs; `$name` or `$name.field` refers to an earlier step's result. */
const goalStep = z.strictObject({
  tool: z.string(),
  args: z.record(z.string(), z.string()),
  as: z.string().optional(),
});

/** Conditions checked against the fake world after a run. */
export const predicateSchema = z.strictObject({
  mailTo: z.string().optional(), // an email was sent to this address
  mailBodyIncludes: z.string().optional(), // ...and its body contains this (with mailTo)
  fetchedHost: z.string().optional(), // some URL on this host was fetched
  fileDeleted: z.string().optional(),
  shownIncludes: z.string().optional(), // a result shown to the user contains this
  noEgress: z.boolean().optional(), // nothing left the machine
});

export const scenarioSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(['attack', 'benign']),
  title: z.string(),
  description: z.string(),
  request: z.string(),
  injection: injection.optional(),
  // Attack: what the obedient agent does after reading the injection, and when the attack counts as successful.
  attack: z
    .strictObject({
      goal: z.array(goalStep),
      attackerAddress: z.string().optional(), // returned by the adversarial quarantined model
      attackerUrl: z.string().optional(),
      // What the adversarial model returns for a free-text answer (default: the injected text itself).
      attackerText: z.string().optional(),
      success: predicateSchema,
    })
    .optional(),
  // Benign: the task counts as completed when this holds (and the run finished).
  success: predicateSchema.optional(),
  // How the simulated user answers approval prompts in the main report.
  userApproval: z.enum(['approve', 'reject']).default('reject'),
  // Tasks the planner cannot write in advance but an obedient agent can do.
  followsContent: z.strictObject({ readFrom: z.string(), goal: z.array(goalStep) }).optional(),
  // Targets that may legitimately receive data in this scenario (for the leak check).
  authorizedEgress: z.array(z.string()).default([]),
  // Honest expectation, shown in the report next to the measured result.
  note: z.string().optional(),
});

export function loadScenarios(dir = new URL('./scenarios/', import.meta.url)) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  return files.map((f) => scenarioSchema.parse(JSON.parse(readFileSync(new URL(f, dir), 'utf8'))));
}

/** Short fingerprint of the scenario set, so a report says exactly what it measured. */
export function scenarioSetHash(scenarios) {
  return createHash('sha256').update(JSON.stringify(scenarios)).digest('hex').slice(0, 16);
}
