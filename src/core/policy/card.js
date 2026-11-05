// The approval card: everything the user needs to judge one paused action.
// Built from the engine's decision and the real values, with fixed wording.
import { isPrivate, isTrusted } from '../labels/index.js';
import { previewValue } from '../preview.js';
import { ROLE } from '../tools/catalog.js';
import { describeOrigin, describeReaders } from './explain.js';

const CARD_PREVIEW_CHARS = 400;

/**
 * @param {{ tool: string, args: Record<string, object>, control: object[], decision: object,
 *           catalog: object }} input
 */
export function buildApprovalCard({ tool, args, control, decision, catalog }) {
  const spec = catalog.get(tool);
  const destinationArgs = Object.entries(spec.params)
    .filter(([, p]) => p.role === ROLE.DESTINATION)
    .map(([name]) => name);

  const argumentsList = Object.entries(args).map(([name, value]) => ({
    name,
    role: spec.params[name].role,
    preview: previewValue(value, CARD_PREVIEW_CHARS),
    origin: describeOrigin(value.label),
    trusted: isTrusted(value.label),
    private: isPrivate(value.label),
    readers: describeReaders(value.label),
  }));

  const warnings = [];
  for (const a of argumentsList) {
    if (a.role === ROLE.DESTINATION && !a.trusted) {
      warnings.push(
        `The destination “${a.preview}” came from ${a.origin} (untrusted text), not from you.`,
      );
    } else if (a.role === ROLE.SELECTOR && !a.trusted) {
      warnings.push(`“${a.name}” was chosen by ${a.origin} (untrusted text), not by you.`);
    } else if (a.role !== ROLE.DESTINATION && a.role !== ROLE.SELECTOR && !a.trusted) {
      warnings.push(
        `The ${a.name} was made from ${a.origin} (untrusted text). It may repeat or twist what that text said.`,
      );
    }
  }
  if (control.some((c) => !isTrusted(c.label))) {
    warnings.push('This action only runs because of a condition that depends on untrusted text.');
  }

  const actions = ['approve_once'];
  if (destinationArgs.length === 1) actions.push('approve_and_trust', 'edit_destination');
  actions.push('reject');

  return {
    tool: { name: tool, title: spec.title, effect: spec.effect },
    explanation: decision.explanation,
    arguments: argumentsList,
    destinationArg: destinationArgs.length === 1 ? destinationArgs[0] : null,
    warnings,
    actions,
  };
}
