// Configuration is read once, validated, and passed around as a plain object.
// Nothing else in the code base reads process.env, which keeps behaviour
// predictable and makes tests independent of the machine's environment.
import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    // Loopback by default. Set HOST=0.0.0.0 only if you understand there is no login.
    HOST: z.string().min(1).default('127.0.0.1'),
    DATABASE_URL: z
      .string({ error: 'DATABASE_URL is required (see .env.example)' })
      .refine((v) => /^postgres(ql)?:\/\//.test(v), 'DATABASE_URL must be a postgresql:// URL'),
    // "mock" needs nothing and is what tests and the evaluation use. A live model
    // is optional and only for demonstrations.
    MODEL_PROVIDER: z.enum(['mock', 'openai_compatible']).default('mock'),
    MODEL_BASE_URL: z.string().url().optional(),
    MODEL_API_KEY: z.string().min(1).optional(),
    PLANNER_MODEL: z.string().min(1).optional(),
    QUARANTINE_MODEL: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.MODEL_PROVIDER === 'openai_compatible') {
      for (const key of ['MODEL_BASE_URL', 'PLANNER_MODEL']) {
        if (!env[key])
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when MODEL_PROVIDER=openai_compatible`,
          });
      }
    }
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
 * @returns {{ nodeEnv: string, port: number, host: string, databaseUrl: string,
 *            model: { provider: string, baseUrl?: string, apiKey?: string,
 *                     plannerModel?: string, quarantineModel?: string } }}
 */
export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${problems.join('\n')}`);
  }
  const d = parsed.data;
  return {
    nodeEnv: d.NODE_ENV,
    port: d.PORT,
    host: d.HOST,
    databaseUrl: d.DATABASE_URL,
    model: {
      provider: d.MODEL_PROVIDER,
      baseUrl: d.MODEL_BASE_URL,
      apiKey: d.MODEL_API_KEY,
      plannerModel: d.PLANNER_MODEL,
      quarantineModel: d.QUARANTINE_MODEL,
    },
  };
}
