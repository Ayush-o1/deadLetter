// The only door to the tool adapters.
//
// createToolInvoker closes over the adapters, so they are not exported anywhere
// else. Calling the returned function without a valid authorization from the
// policy gate throws before any adapter code runs. Adapters receive plain data
// (the values' contents), never labelled values, so they cannot alter labels.
import { consumeAuthorization } from '../policy/authorization.js';

/**
 * @param {Record<string, (args: Record<string, unknown>) => unknown>} adapters
 */
export function createToolInvoker(adapters) {
  const table = Object.freeze({ ...adapters });
  return async function invokeTool(tool, args, authorization) {
    consumeAuthorization(authorization, tool, args);
    if (!Object.hasOwn(table, tool)) throw new Error(`No adapter for tool "${tool}"`);
    const plain = Object.fromEntries(
      Object.entries(args).map(([name, value]) => [name, value.data]),
    );
    return table[tool](plain);
  };
}
