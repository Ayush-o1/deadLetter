// The two baseline guards. Each decides, per tool call, whether the undefended
// agent may proceed.
import { ROLE } from '../core/tools/catalog.js';

/** Defence 1: no protection. */
export const noGuard = Object.freeze({
  check: () => ({ allow: true }),
});

/**
 * Defence 2: session taint. Once the agent has read anything untrusted, it may
 * not call any tool that sends data out, changes things, or names a destination.
 * Reads of local data stay allowed. It is a deliberately simple, strong baseline:
 * it does not look at WHERE an action is going, only at whether the session has
 * been exposed.
 */
export function createSessionTaintGuard(catalog) {
  return Object.freeze({
    check({ tool }, state) {
      if (!state.tainted) return { allow: true };
      const spec = catalog.get(tool);
      const outbound =
        !spec ||
        spec.effect !== 'read' ||
        Object.values(spec.params).some((p) => p.role === ROLE.DESTINATION);
      return outbound ? { allow: false, reason: 'session_tainted' } : { allow: true };
    },
  });
}
