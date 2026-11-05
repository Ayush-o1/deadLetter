// The policy gate: the `authorize` function the interpreter calls before every
// tool call. It is the only place that mints authorization tokens.
//
//   engine says allow -> mint a token, execute
//   engine says deny  -> refuse. A human cannot override a deny.
//   engine says ask   -> pause until the user resolves it, then
//                          approve_once        execute
//                          approve_and_trust   remember the destination, execute
//                          edit_destination    re-check with the new destination
//                          reject / cancel / anything else   refuse
//
// "Anything else" refusing is deliberate: an unrecognised answer from the
// approval layer must never turn into permission.
import { buildApprovalCard } from './card.js';
import { mintAuthorization } from './authorization.js';
import { normalizeDestination } from './config.js';
import { evaluate } from './engine.js';

/**
 * @param {object} deps
 * @param {ReturnType<import('../tools/catalog.js').defineCatalog>} deps.catalog
 * @param {import('../labels/provenance.js').ProvenanceStore} deps.store
 * @param {() => Promise<object> | object} deps.getConfig   returns a parsed policy config
 * @param {(request: object) => Promise<{ action: string, destination?: string }>} deps.requestApproval
 * @param {(destination: string) => Promise<void> | void} [deps.onTrustDestination]
 * @param {(record: object) => void} [deps.onDecision]   one call per tool call, for the audit log
 */
export function createPolicyGate({
  catalog,
  store,
  getConfig,
  requestApproval,
  onTrustDestination = () => {},
  onDecision = () => {},
}) {
  const execute = (tool, args, decision, decidedBy, extra = {}) => {
    onDecision({ tool, args, decision, decidedBy, outcome: 'executed', ...extra });
    return {
      outcome: 'execute',
      args,
      authorization: mintAuthorization(tool, args),
      decision,
      decidedBy,
    };
  };

  const refuse = (tool, args, decision, decidedBy, reason, message, extra = {}) => {
    onDecision({ tool, args, decision, decidedBy, outcome: 'blocked', reason, ...extra });
    return { outcome: 'blocked', reason, message, decision, decidedBy };
  };

  return async function authorize({ stepId, tool, args, control }) {
    const config = await getConfig();
    const decision = evaluate({ tool, args, control, config, catalog });
    const base = { stepId, control };

    if (decision.decision === 'allow') return execute(tool, args, decision, 'engine', base);
    if (decision.decision === 'deny') {
      return refuse(tool, args, decision, 'engine', 'denied', decision.explanation.headline, base);
    }

    // ---- ask: execution is paused here until a person decides ----------------
    const card = buildApprovalCard({ tool, args, control, decision, catalog });
    const resolution = await requestApproval({ stepId, tool, args, control, decision, card });
    const withResolution = { ...base, resolution: { action: resolution?.action } };

    switch (resolution?.action) {
      case 'approve_once':
        return execute(tool, args, decision, 'user', withResolution);

      case 'approve_and_trust': {
        const destinationArg = card.destinationArg;
        if (!destinationArg) break; // nothing to trust: treat as a refusal
        await onTrustDestination(normalizeDestination(args[destinationArg].data));
        return execute(tool, args, decision, 'user', withResolution);
      }

      case 'edit_destination': {
        const destinationArg = card.destinationArg;
        const typed =
          typeof resolution.destination === 'string' ? resolution.destination.trim() : '';
        if (!destinationArg || typed === '' || typed.length > 500) break;
        // What the user typed is a user-chosen value; it replaces the proposed one
        // and the whole call is judged again.
        const edited = store.literal(typed, { source: 'user_approval' });
        const newArgs = { ...args, [destinationArg]: edited };
        const second = evaluate({
          tool,
          args: newArgs,
          control,
          config: await getConfig(),
          catalog,
        });
        if (second.decision === 'deny') {
          return refuse(
            tool,
            newArgs,
            second,
            'engine',
            'denied',
            second.explanation.headline,
            withResolution,
          );
        }
        // allow, or ask: the user has now reviewed the card and chosen the destination.
        return execute(tool, newArgs, second, 'user', withResolution);
      }

      case 'cancel':
        return refuse(
          tool,
          args,
          decision,
          'user',
          'cancelled',
          'The run was cancelled',
          withResolution,
        );

      default:
    }
    return refuse(
      tool,
      args,
      decision,
      'user',
      'rejected',
      'You rejected this action',
      withResolution,
    );
  };
}
