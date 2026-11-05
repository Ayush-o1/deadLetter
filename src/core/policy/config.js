// Policy configuration: which tools are on, which template each one uses, and
// which destinations the user has chosen to trust.
//
// Fail-closed property: a missing entry never allows. A tool in the catalog with
// no entry here is answered "ask" by the engine.
import { z } from 'zod';
import { ROLE } from '../tools/catalog.js';

/** The choices offered on the Rules tab. */
export const TEMPLATES = Object.freeze({
  allow: {
    title: 'Allow',
    description:
      'Run without asking. The built-in safety rules still apply: an untrusted value cannot choose a destination or a target, and private data cannot go to an untrusted destination.',
  },
  ask: { title: 'Always ask', description: 'Pause and show the action every time.' },
  deny: { title: 'Always deny', description: 'Never run this tool.' },
  trusted_destination: {
    title: 'Destination must be trusted',
    description:
      'Run when the destination is one you named or trust. Ask if private data would go to a destination that is not allowed to receive it.',
  },
});

export const normalizeDestination = (text) => String(text).trim().toLowerCase();

/** Sensible defaults derived from what each tool does. */
export function defaultPolicyConfig(catalog) {
  const tools = {};
  for (const spec of catalog.list()) {
    const hasDestination = Object.values(spec.params).some((p) => p.role === ROLE.DESTINATION);
    tools[spec.name] = {
      enabled: true,
      template: hasDestination
        ? 'trusted_destination'
        : spec.effect === 'destructive'
          ? 'ask'
          : 'allow',
    };
  }
  return { tools, trustedDestinations: [] };
}

const configSchema = z.strictObject({
  tools: z.record(
    z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
    z.strictObject({ enabled: z.boolean(), template: z.enum(Object.keys(TEMPLATES)) }),
  ),
  trustedDestinations: z.array(z.string().min(1).max(500)).max(500),
});

/**
 * Validate configuration from storage or from the Rules tab.
 * @returns {{ ok: true, config: object } | { ok: false, errors: string[] }}
 */
export function parsePolicyConfig(input) {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }
  const tools = Object.create(null);
  for (const [name, setting] of Object.entries(parsed.data.tools))
    tools[name] = Object.freeze({ ...setting });
  return {
    ok: true,
    config: Object.freeze({
      tools: Object.freeze(tools),
      trustedDestinations: new Set(parsed.data.trustedDestinations.map(normalizeDestination)),
    }),
  };
}
