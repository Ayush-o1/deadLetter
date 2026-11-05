// Plain-language explanations for policy decisions, filled in from fixed
// templates and the real values involved.
//
// Never produced by a language model (the product spec rules this out): a model
// would read untrusted text and could state something false about a security
// decision. Everything here is a string template plus facts the engine computed.
import { isTrusted } from '../labels/index.js';
import { previewValue } from '../preview.js';

/**
 * Where a value came from, in words.
 *
 * For an untrusted value only the outside sources are named. Trusted inputs
 * (your request, your contacts) may also appear in its sources, because a value
 * inherits everything it was made from, but listing them next to the untrusted
 * origin would suggest the user had a hand in it.
 */
export function describeOrigin(label) {
  const has = (prefix) => label.sources.some((s) => s === prefix || s.startsWith(`${prefix}:`));
  const outside = [];
  if (has('email')) outside.push('an email');
  if (has('file')) outside.push('a file');
  if (has('web')) outside.push('a web page');
  const own = [];
  if (has('contacts')) own.push('your contacts');
  if (has('user_request')) own.push('your request');
  if (has('user_approval')) own.push('an address you entered when approving');
  if (has('plan')) own.push('the plan');

  const parts =
    label.integrity === 'untrusted' && outside.length > 0 ? outside : [...outside, ...own];
  const text = parts.length > 0 ? parts.join(' and ') : null;
  if (has('quarantine')) {
    return text
      ? `${text}, processed by the quarantined model`
      : 'text produced by the quarantined model';
  }
  return text ?? 'an unknown source';
}

/** Who may receive a value, in words. */
export function describeReaders(label) {
  if (label.readers.kind === 'public') return 'anyone';
  const others = label.readers.principals;
  return others.length === 0 ? 'only you' : `you and ${others.join(', ')}`;
}

const quote = (text) => `“${text}”`;

/**
 * Rule titles (shown as "Rule: ...") and the "what you can do" advice.
 * Keys are the rule ids used by the engine.
 */
const RULES = {
  unknown_tool: {
    title: 'Only known tools can run',
    next: ['Nothing ran. This tool is not part of deadLetter.'],
  },
  invalid_arguments: {
    title: 'Arguments must match the tool and be tracked values',
    next: ['Nothing ran. This indicates a bug; the run has stopped.'],
  },
  tool_disabled: {
    title: 'This tool is turned off',
    next: ['Turn the tool on in Rules if you want it to be available.'],
  },
  no_rule_configured: {
    title: 'A tool with no rule always asks',
    next: ['Choose a rule for this tool in Rules so it stops asking.'],
  },
  untrusted_selector: {
    title: 'Untrusted text cannot choose what to act on',
    next: ['Approve only if you recognise the target.', 'Or reject; nothing happens.'],
  },
  untrusted_destination: {
    title: 'Untrusted text cannot choose a destination',
    next: [
      'Send once, if you recognise it.',
      'Send and trust, to stop being asked about this destination.',
      'Edit the destination, or reject.',
    ],
  },
  untrusted_destination_private_data: {
    title: 'Private data cannot go to a destination chosen by untrusted text',
    next: [
      'Nothing was sent.',
      'If you know this destination, add it to your contacts or name it in your request.',
    ],
  },
  untrusted_control_flow: {
    title: 'An action that only runs because of untrusted text needs your approval',
    next: [
      'Approve only if you would have wanted this action anyway.',
      'Or reject; nothing happens.',
    ],
  },
  recipient_not_permitted_private_data: {
    title: 'Private data needs a recipient who may receive it',
    next: [
      'Send once, if you want this person to have it.',
      'Name the recipient in your request next time to allow it without asking.',
    ],
  },
  template_ask: { title: 'This tool is set to always ask', next: ['Approve or reject.'] },
  template_deny: {
    title: 'This tool is set to always deny',
    next: ['Change the rule in Rules if you want to allow it.'],
  },
};

/** Reasons that describe a specific argument. */
function because(f, facts) {
  const arg = f.arg ? facts.args[f.arg] : undefined;
  switch (f.ruleId) {
    case 'untrusted_selector':
      return `${arg.name} (${quote(arg.preview)}) came from ${arg.origin}, which is untrusted, and it picks which item to act on.`;
    case 'untrusted_destination':
    case 'untrusted_destination_private_data':
      return `The ${arg.name} ${quote(arg.preview)} came from ${arg.origin}, so it is untrusted.`;
    case 'recipient_not_permitted_private_data':
      return `${quote(arg.preview)} is a trusted destination, but it was not named in your request and is not allowed to receive this private data.`;
    case 'untrusted_control_flow':
      return `This step only runs because of a condition that depends on untrusted text (from ${facts.controlOrigin}).`;
    case 'no_rule_configured':
      return `There is no rule for “${facts.toolTitle}”, so it asks every time.`;
    default:
      return null;
  }
}

/**
 * @param {{ decision: string, fired: object[], tool: string }} decision
 * @param {{ spec?: object, args: object, outgoingPrivate: boolean, controlOrigin: string }} context
 */
export function explainDecision(decision, context) {
  const toolTitle = context.spec?.title ?? decision.tool;
  const args = {};
  for (const [name, value] of Object.entries(context.args)) {
    args[name] = {
      name,
      preview: previewValue(value, 80),
      origin: describeOrigin(value.label),
      trusted: isTrusted(value.label),
      readers: describeReaders(value.label),
    };
  }
  const facts = { args, toolTitle, controlOrigin: context.controlOrigin };

  const primary = decision.fired[0];
  const rule = RULES[primary?.ruleId];
  const destination = Object.values(args).find((a) => context.destinationArgs?.includes(a.name));
  const subject = destination ? `${toolTitle} to ${quote(destination.preview)}` : toolTitle;

  const reasons = decision.fired.map((f) => because(f, facts)).filter(Boolean);
  if (context.outgoingPrivate && decision.fired.some((f) => /private_data/.test(f.ruleId))) {
    reasons.push('The data being sent is private: it is not readable by everyone.');
  }

  const headline =
    decision.decision === 'allow'
      ? `Allowed: ${subject}.`
      : decision.decision === 'deny'
        ? `Blocked: ${subject}.`
        : `Needs your approval: ${subject}.`;

  return {
    headline,
    reasons,
    rule: rule?.title ?? (decision.decision === 'allow' ? 'Every check passed' : primary?.ruleId),
    next: decision.decision === 'allow' ? [] : (rule?.next ?? []),
  };
}
