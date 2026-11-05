// Rules storage: per-tool settings and the list of trusted destinations.
//
// Fail-closed behaviour lives here and in the engine:
//   * defaults are written for every tool the first time (seedDefaults), so a fresh
//     install is usable;
//   * a tool whose row is missing later gets NO setting, and the engine answers
//     "ask" for it;
//   * if what is stored cannot be parsed, getConfig returns a configuration with no
//     tool settings and no trusted destinations, so every call asks.
import {
  defaultPolicyConfig,
  normalizeDestination,
  parsePolicyConfig,
} from '../core/policy/config.js';

/**
 * @param {import('../generated/client.ts').PrismaClient} db
 * @param {ReturnType<import('../core/tools/catalog.js').defineCatalog>} catalog
 */
export function createPrismaPolicyRepository(db, catalog, logger = console) {
  return {
    /** Insert default rules for tools that have none. Never overwrites a user's choice. */
    async seedDefaults() {
      const { tools } = defaultPolicyConfig(catalog);
      await db.toolSetting.createMany({
        data: Object.entries(tools).map(([tool, s]) => ({
          tool,
          enabled: s.enabled,
          template: s.template,
        })),
        skipDuplicates: true,
      });
    },

    /** The parsed configuration the policy engine uses. */
    async getConfig() {
      const [settings, trusted] = await Promise.all([
        db.toolSetting.findMany(),
        db.trustedDestination.findMany(),
      ]);
      const parsed = parsePolicyConfig({
        tools: Object.fromEntries(
          settings.map((s) => [s.tool, { enabled: s.enabled, template: s.template }]),
        ),
        trustedDestinations: trusted.map((t) => t.destination),
      });
      if (parsed.ok) return parsed.config;
      logger.error(
        'Stored rules are invalid; every tool will ask until they are fixed:',
        parsed.errors,
      );
      return parsePolicyConfig({ tools: {}, trustedDestinations: [] }).config;
    },

    /** Settings for the Rules tab: every catalog tool, with its stored setting if any. */
    async listTools() {
      const settings = new Map((await db.toolSetting.findMany()).map((s) => [s.tool, s]));
      return catalog.list().map((spec) => {
        const s = settings.get(spec.name);
        return {
          name: spec.name,
          title: spec.title,
          effect: spec.effect,
          params: spec.params,
          configured: Boolean(s),
          enabled: s?.enabled ?? null,
          template: s?.template ?? null,
        };
      });
    },

    async setTool(tool, { enabled, template }) {
      if (!catalog.has(tool)) return false;
      const parsed = parsePolicyConfig({
        tools: { [tool]: { enabled, template } },
        trustedDestinations: [],
      });
      if (!parsed.ok) throw new TypeError(parsed.errors.join('; '));
      await db.toolSetting.upsert({
        where: { tool },
        create: { tool, enabled, template },
        update: { enabled, template },
      });
      return true;
    },

    async listTrusted() {
      return (await db.trustedDestination.findMany({ orderBy: { createdAt: 'asc' } })).map((t) => ({
        destination: t.destination,
        createdAt: t.createdAt.toISOString(),
      }));
    },

    async addTrusted(destination) {
      const normalized = normalizeDestination(destination);
      await db.trustedDestination.upsert({
        where: { destination: normalized },
        create: { destination: normalized },
        update: {},
      });
      return normalized;
    },

    async removeTrusted(destination) {
      const { count } = await db.trustedDestination.deleteMany({
        where: { destination: normalizeDestination(destination) },
      });
      return count > 0;
    },
  };
}
