// Single-use authorization tokens: the proof that the policy gate approved a call.
//
// A token is bound to one tool and the exact argument values (compared by
// identity, not by content). It works once. The tool invoker refuses to run
// anything without a valid token, so even if some other part of the code
// obtained a tool adapter, it could not use it unless the gate had said yes.
//
// RULE (checked by test/security/architecture.test.js):
//   mintAuthorization may be used only by policy/gate.js
//   consumeAuthorization may be used only by tools/invoke.js

const grants = new WeakMap();

export class UnauthorizedToolCall extends Error {
  constructor(reason) {
    super(`Tool call refused: ${reason}`);
    this.name = 'UnauthorizedToolCall';
  }
}

/** Only the policy gate calls this. */
export function mintAuthorization(tool, args) {
  const token = Object.freeze({ kind: 'tool-authorization' });
  grants.set(token, { tool, args: Object.freeze({ ...args }), used: false });
  return token;
}

/** Only the tool invoker calls this. Throws unless the token matches this exact call. */
export function consumeAuthorization(token, tool, args) {
  const grant = token !== null && typeof token === 'object' ? grants.get(token) : undefined;
  if (!grant) throw new UnauthorizedToolCall('no valid authorization');
  if (grant.used) throw new UnauthorizedToolCall('authorization was already used');
  if (grant.tool !== tool) throw new UnauthorizedToolCall('authorization is for a different tool');

  const approved = Object.keys(grant.args).sort();
  const given = Object.keys(args ?? {}).sort();
  if (approved.length !== given.length || approved.some((k, i) => k !== given[i])) {
    throw new UnauthorizedToolCall('arguments differ from the approved ones');
  }
  for (const key of approved) {
    if (grant.args[key] !== args[key])
      throw new UnauthorizedToolCall('an argument value was swapped');
  }
  grant.used = true;
}
