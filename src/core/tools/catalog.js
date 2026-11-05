// The tool catalog: what tools exist and what each argument is FOR.
//
// The plan validator, the policy engine and the plan preview all read this. The
// important idea is the argument *role*, which says what an argument does:
//
//   destination  where data goes      send_email.to, fetch_url.url
//   selector     which thing to act on read_file.path, read_email.from
//   data         content being moved  send_email.body
//   plain        anything else        send_email.subject, read_email.which
//
// Roles are what let one generic rule say "an untrusted value may not choose a
// destination or a selector" without knowing anything about individual tools.

export const ROLE = Object.freeze({
  DESTINATION: 'destination',
  SELECTOR: 'selector',
  DATA: 'data',
  PLAIN: 'plain',
});

export const EFFECT = Object.freeze({
  READ: 'read', // only reads
  SEND: 'send', // moves data out of the machine
  DESTRUCTIVE: 'destructive', // changes or removes data
});

const NAME = /^[a-z][a-z0-9_]{0,30}$/;
const ROLES = new Set(Object.values(ROLE));
const EFFECTS = new Set(Object.values(EFFECT));

/**
 * @typedef {{ role: string, required?: boolean }} ParamSpec
 * @typedef {{ name: string, title: string, effect: string, params: Record<string, ParamSpec> }} ToolSpec
 */

/**
 * Validate tool specs and return a read-only catalog.
 * @param {ToolSpec[]} specs
 */
export function defineCatalog(specs) {
  const tools = new Map();
  for (const spec of specs) {
    if (!NAME.test(spec.name)) throw new TypeError(`Bad tool name "${spec.name}"`);
    if (tools.has(spec.name)) throw new TypeError(`Duplicate tool "${spec.name}"`);
    if (!EFFECTS.has(spec.effect)) throw new TypeError(`${spec.name}: bad effect "${spec.effect}"`);
    const params = Object.create(null);
    for (const [param, p] of Object.entries(spec.params)) {
      if (!NAME.test(param)) throw new TypeError(`${spec.name}: bad parameter name "${param}"`);
      if (!ROLES.has(p.role)) throw new TypeError(`${spec.name}.${param}: bad role "${p.role}"`);
      params[param] = Object.freeze({ role: p.role, required: p.required !== false });
    }
    tools.set(spec.name, Object.freeze({ ...spec, params: Object.freeze(params) }));
  }
  return Object.freeze({
    has: (name) => tools.has(name),
    get: (name) => tools.get(name),
    names: () => [...tools.keys()],
    list: () => [...tools.values()],
  });
}
