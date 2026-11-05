// The policy engine: one pure function, evaluate(), that turns
// "this tool, with these labelled arguments, in this control context" into
// allow, ask or deny.
//
// Two layers decide, and the STRICTER answer wins (deny > ask > allow):
//
//   FLOOR      rules that hold for every tool and cannot be turned off from the
//              Rules tab. They encode the project's central claim: untrusted
//              text cannot choose a destination or a target, and private data
//              cannot reach an untrusted destination.
//   TEMPLATE   the per-tool choice the user makes (allow / ask / deny /
//              trusted_destination).
//
// Because the answers are combined by taking the stricter one, a missing or
// mistaken setting can only make a decision stricter, never looser. Anything
// the engine cannot understand (unknown tool, malformed arguments) is denied.
//
// The engine reads labels, never text. It performs no I/O.
import { canReceive, isPrivate, isTrusted, isValue } from '../labels/index.js';
import { EFFECT, ROLE } from '../tools/catalog.js';
import { normalizeDestination } from './config.js';
import { describeOrigin, explainDecision } from './explain.js';

const SEVERITY = { allow: 0, ask: 1, deny: 2 };

/** Sources that mean "the user chose this value themselves". */
const USER_CHOICE = new Set(['user_request', 'user_approval']);

/**
 * Did the user themselves choose this destination? True for an address typed in
 * the request, one entered while approving, or one read from the user's own
 * contacts. Decided from how the value was created (its origin), not from its
 * label, so a trusted value that merely mentions the user's request does not count.
 */
function namedByUser(value, catalog) {
  if (!isTrusted(value.label)) return false;
  const { origin } = value;
  if (origin.kind === 'literal') return USER_CHOICE.has(origin.name);
  if (origin.kind === 'tool') return catalog.get(origin.name)?.namesRecipients === true;
  return false;
}

/** Trusted by label, or an exact match in the user's trusted-destinations list. */
function destinationTrusted(value, config) {
  if (isTrusted(value.label)) return true;
  return (
    typeof value.data === 'string' &&
    config.trustedDestinations.has(normalizeDestination(value.data))
  );
}

/**
 * @param {object} input
 * @param {string} input.tool
 * @param {Record<string, object>} input.args    argument name -> Value
 * @param {object[]} input.control               values the call is control-dependent on
 * @param {{ tools: object, trustedDestinations: Set<string> }} input.config  from parsePolicyConfig
 * @param {ReturnType<import('../tools/catalog.js').defineCatalog>} input.catalog
 */
export function evaluate({ tool, args, control = [], config, catalog }) {
  const fired = [];
  const fire = (decision, ruleId, extra = {}) => fired.push({ decision, ruleId, ...extra });
  const spec = catalog.get(tool);

  const finish = (context = {}) => {
    // Strictest first; ties keep the order in which the rules fired.
    fired.sort((a, b) => SEVERITY[b.decision] - SEVERITY[a.decision]);
    const decision = fired[0]?.decision ?? 'allow';
    const result = {
      decision,
      ruleId: fired[0]?.ruleId ?? context.allowRule,
      fired: fired.filter((f) => f.decision !== 'allow'),
      tool,
    };
    result.explanation = explainDecision(result, {
      spec,
      args: context.safeArgs ?? {},
      outgoingPrivate: context.outgoingPrivate ?? false,
      controlOrigin: context.controlOrigin ?? '',
      destinationArgs: context.destinationArgs ?? [],
    });
    return Object.freeze(result);
  };

  // ---- Rules about the call itself -------------------------------------------
  if (!spec) {
    fire('deny', 'unknown_tool');
    return finish();
  }

  const argEntries = Object.entries(args ?? {});
  const wellFormed =
    argEntries.every(([name, v]) => Object.hasOwn(spec.params, name) && isValue(v)) &&
    Object.entries(spec.params).every(
      ([name, p]) => !p.required || Object.hasOwn(args ?? {}, name),
    ) &&
    control.every(isValue);
  if (!wellFormed) {
    fire('deny', 'invalid_arguments');
    return finish();
  }

  const setting = Object.hasOwn(config.tools, tool) ? config.tools[tool] : undefined;
  if (!setting) fire('ask', 'no_rule_configured');
  else if (!setting.enabled) fire('deny', 'tool_disabled');

  // ---- Group the arguments by what they are for ------------------------------
  const byRole = (role) => argEntries.filter(([name]) => spec.params[name].role === role);
  const destinations = byRole(ROLE.DESTINATION);
  const selectors = byRole(ROLE.SELECTOR);
  // What leaves the machine: for a send, every argument except the destination;
  // for any tool, the destination itself (a URL can carry data in its text).
  const content =
    spec.effect === EFFECT.SEND
      ? argEntries.filter(([n]) => spec.params[n].role !== ROLE.DESTINATION)
      : [];
  const outgoing = [...content, ...destinations].map(([, v]) => v);
  const outgoingPrivate = outgoing.some((v) => isPrivate(v.label));

  // ---- FLOOR -----------------------------------------------------------------
  for (const [name, value] of selectors) {
    if (!isTrusted(value.label)) fire('ask', 'untrusted_selector', { arg: name });
  }
  const trustedDestinations = [];
  for (const [name, value] of destinations) {
    if (destinationTrusted(value, config)) trustedDestinations.push([name, value]);
    else if (outgoingPrivate) fire('deny', 'untrusted_destination_private_data', { arg: name });
    else fire('ask', 'untrusted_destination', { arg: name });
  }
  const untrustedControl = control.filter((c) => !isTrusted(c.label));
  if (untrustedControl.length > 0) {
    fire('ask', 'untrusted_control_flow', { values: untrustedControl.map((c) => c.id) });
  }

  // ---- TEMPLATE --------------------------------------------------------------
  let allowRule = 'allowed_no_restrictions';
  if (setting?.enabled) {
    switch (setting.template) {
      case 'ask':
        fire('ask', 'template_ask');
        break;
      case 'deny':
        fire('deny', 'template_deny');
        break;
      case 'trusted_destination': {
        allowRule = 'allowed_destination_trusted';
        // Trusted destination, but may it receive THIS data? It may if the user
        // named it, or if every private value is readable by it.
        const privateValues = outgoing.filter((v) => isPrivate(v.label));
        for (const [name, dest] of trustedDestinations) {
          const permitted =
            namedByUser(dest, catalog) ||
            privateValues.every(
              (v) => typeof dest.data === 'string' && canReceive(v.label, dest.data),
            );
          if (privateValues.length > 0 && !permitted) {
            fire('ask', 'recipient_not_permitted_private_data', { arg: name });
          }
        }
        break;
      }
      default: // 'allow'
        allowRule = 'allowed_by_rule';
    }
  }

  return finish({
    allowRule,
    outgoingPrivate,
    destinationArgs: destinations.map(([n]) => n),
    controlOrigin: describeOrigin({ sources: untrustedControl.flatMap((c) => c.label.sources) }),
    safeArgs: Object.fromEntries(argEntries),
  });
}
