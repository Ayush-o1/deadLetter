// Evaluating the three expression forms: lit, ref, concat.
//
// Every result is a Value created through the ProvenanceStore, so labels are
// computed here and cannot be chosen by the plan.
import { fail } from './errors.js';

const MAX_TEXT = 20_000;

/** Variables, with nested scopes for blocks. A name can be defined only once. */
export class Scope {
  #vars = new Map();
  #parent;

  constructor(parent = null) {
    this.#parent = parent;
  }

  get(name) {
    if (this.#vars.has(name)) return this.#vars.get(name);
    return this.#parent ? this.#parent.get(name) : undefined;
  }

  define(name, value) {
    if (this.get(name) !== undefined)
      throw fail('variable_redefined', `Variable "${name}" is already defined`);
    this.#vars.set(name, value);
  }
}

/** How a value reads when joined into text. */
function asText(data) {
  if (typeof data === 'string') return data;
  if (data !== null && typeof data === 'object') return JSON.stringify(data);
  return String(data);
}

/**
 * @param {object} expr  a validated expression
 * @param {{ store: object, scope: Scope, control: object[] }} rt
 * @param {{ grounded?: boolean }} [opts] grounded: literals here were checked against the request
 */
export function evaluate(expr, rt, opts = {}) {
  const { store, scope, control } = rt;

  if ('lit' in expr) {
    return store.literal(expr.lit, { source: opts.grounded ? 'user_request' : 'plan', control });
  }

  if ('ref' in expr) {
    let value = scope.get(expr.ref);
    if (value === undefined) throw fail('bad_reference', `Variable "${expr.ref}" has no value`);
    for (const name of expr.path ?? []) {
      try {
        value = store.field(value, name);
      } catch {
        throw fail('bad_reference', `"${expr.ref}" has no field "${name}"`);
      }
    }
    return value;
  }

  const parts = expr.concat.map((part) => evaluate(part, rt, opts));
  const text = parts.map((p) => asText(p.data)).join('');
  if (text.length > MAX_TEXT) throw fail('text_too_long', 'Combined text is too long');
  return store.derive({ data: text, parents: parts, op: 'concat', control });
}
