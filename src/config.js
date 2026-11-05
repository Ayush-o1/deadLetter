// Configuration is read once, validated, and passed around as a plain object.
// Nothing else in the code base reads process.env, which keeps behaviour
// predictable and makes tests independent of the machine's environment.
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required (see .env.example)' })
    .refine((v) => /^postgres(ql)?:\/\//.test(v), 'DATABASE_URL must be a postgresql:// URL'),
});

/**
 * Load .env into process.env if the file exists. Variables that are already set
 * (shell, CI) are never overridden.
 */
export function loadDotEnv() {
  try {
    process.loadEnvFile();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Validate environment variables and return the typed configuration.
 * Throws an Error listing every problem, so a bad setup is fixed in one go.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ nodeEnv: string, port: number, databaseUrl: string }}
 */
export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${problems.join('\n')}`);
  }
  const { NODE_ENV, PORT, DATABASE_URL } = parsed.data;
  return { nodeEnv: NODE_ENV, port: PORT, databaseUrl: DATABASE_URL };
}
