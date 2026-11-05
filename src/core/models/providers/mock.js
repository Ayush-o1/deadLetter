// Deterministic stand-ins for the two models, for tests, demos and evaluation.
// No network, no randomness: the same input always gives the same output.
//
// The mock planner is a small set of request patterns (the scenarios from the
// product spec). It is NOT a language model and cannot plan arbitrary requests;
// anything it does not recognise is reported as "cannot plan". The live provider
// handles open-ended requests.

class CannotPlan extends Error {
  constructor(message) {
    super(message);
    this.name = 'CannotPlan';
    this.code = 'cannot_plan';
  }
}

const NAME = String.raw`[\w.@-]+?`;
const call = (id, tool, args, as) => ({ id, op: 'call', tool, args, ...(as ? { as } : {}) });
const lit = (value) => ({ lit: value });
const isAddress = (s) => s.includes('@');

/** Resolve a recipient: an address typed in the request is used directly; a name goes through contacts. */
function recipient(steps, who, varName) {
  if (isAddress(who)) return lit(who);
  steps.push(call(`lookup_${varName}`, 'lookup_contact', { name: lit(who) }, varName));
  return { ref: varName, path: ['email'] };
}

const PATTERNS = [
  {
    // "Read Bob's latest email, summarise it, and send the summary to Alice."
    name: 'read_summarise_send',
    re: new RegExp(
      String.raw`^read\s+(?<from>${NAME})(?:'s|’s)?\s+(?:latest\s+|last\s+|most recent\s+)?e-?mail,?\s+summari[sz]e\s+it,?\s+(?:and\s+)?send\s+(?:the\s+summary|it)\s+to\s+(?<to>${NAME})\.?$`,
      'i',
    ),
    build: ({ from, to }) => {
      const steps = [];
      const dest = recipient(steps, to, 'dest');
      steps.push(
        call('read', 'read_email', { from: lit(from), which: lit('latest') }, 'mail'),
        {
          id: 'sum',
          op: 'quarantine',
          task: 'summarize',
          input: { ref: 'mail', path: ['body'] },
          output: 'text',
          as: 'summary',
        },
        call('send', 'send_email', {
          to: dest,
          subject: lit('Summary of the latest email'),
          body: { ref: 'summary' },
        }),
      );
      return steps;
    },
  },
  {
    // "Summarise https://example.org/post"
    name: 'summarise_url',
    re: /^summari[sz]e\s+(?<url>https?:\/\/\S+?)[.,]?$/i,
    build: ({ url }) => [
      call('fetch', 'fetch_url', { url: lit(url) }, 'page'),
      {
        id: 'sum',
        op: 'quarantine',
        task: 'summarize',
        input: { ref: 'page' },
        output: 'text',
        as: 'summary',
      },
      { id: 'show', op: 'show', title: 'Summary', value: { ref: 'summary' } },
    ],
  },
  {
    // "Summarise my private file contract.pdf"
    name: 'summarise_file',
    re: /^summari[sz]e\s+(?:my\s+)?(?:private\s+)?file\s+(?<path>[\w./-]+?)[.,]?$/i,
    build: ({ path }) => [
      call('read', 'read_file', { path: lit(path) }, 'doc'),
      {
        id: 'sum',
        op: 'quarantine',
        task: 'summarize',
        input: { ref: 'doc' },
        output: 'text',
        as: 'summary',
      },
      { id: 'show', op: 'show', title: 'Summary', value: { ref: 'summary' } },
    ],
  },
  {
    // "Read brief.txt and email its summary to the project lead."
    name: 'read_file_email_role',
    re: /^read\s+(?:the\s+)?(?<path>[\w./-]+\.\w+)\s+and\s+(?:email|send)\s+its\s+summary\s+to\s+the\s+(?<role>[\w ]+?)\.?$/i,
    build: ({ path, role }) => [
      call('read', 'read_file', { path: lit(path) }, 'doc'),
      {
        id: 'who',
        op: 'quarantine',
        task: 'extract',
        instruction: `the email address of the ${role}`,
        input: { ref: 'doc' },
        output: 'email',
        as: 'target',
      },
      {
        id: 'sum',
        op: 'quarantine',
        task: 'summarize',
        input: { ref: 'doc' },
        output: 'text',
        as: 'summary',
      },
      call('send', 'send_email', {
        to: { ref: 'target' },
        subject: lit('Summary'),
        body: { ref: 'summary' },
      }),
    ],
  },
  {
    // "Read Bob's latest email. If it is urgent, tell Alice, otherwise tell Carol."
    name: 'conditional_recipient',
    re: new RegExp(
      String.raw`^read\s+(?<from>${NAME})(?:'s|’s)?\s+(?:latest\s+)?e-?mail\.?\s+if\s+it\s+(?:is|says)\s+(?<flag>urgent|important),?\s+(?:send|tell|email)\s+(?<a>${NAME}),?\s+otherwise\s+(?:send|tell|email)\s+(?<b>${NAME})\.?$`,
      'i',
    ),
    build: ({ from, flag, a, b }) => {
      const pre = [];
      const destA = recipient(pre, a, 'first');
      const destB = recipient(pre, b, 'second');
      const note = (to, text) =>
        call(`send_${to === destA ? 'a' : 'b'}`, 'send_email', {
          to,
          subject: lit('Note'),
          body: lit(text),
        });
      return [
        ...pre,
        call('read', 'read_email', { from: lit(from) }, 'mail'),
        {
          id: 'flag',
          op: 'quarantine',
          task: 'extract',
          instruction: `does the email say it is ${flag}`,
          input: { ref: 'mail', path: ['body'] },
          output: 'boolean',
          as: 'flagged',
        },
        {
          id: 'branch',
          op: 'if',
          cond: { ref: 'flagged' },
          then: [note(destA, `Bob's email looks ${flag}`)],
          else: [note(destB, "Bob's email can wait")],
        },
      ];
    },
  },
  {
    // "Show Bob's latest email."
    name: 'show_email',
    re: new RegExp(
      String.raw`^(?:show|read)\s+(?<from>${NAME})(?:'s|’s)?\s+(?:latest\s+)?e-?mail\.?$`,
      'i',
    ),
    build: ({ from }) => [
      call('read', 'read_email', { from: lit(from) }, 'mail'),
      { id: 'show', op: 'show', title: 'Email', value: { ref: 'mail', path: ['body'] } },
    ],
  },
  {
    // "Delete the file notes.txt"
    name: 'delete_file',
    re: /^delete\s+(?:the\s+)?(?:file\s+)?(?<path>[\w./-]+\.\w+)\.?$/i,
    build: ({ path }) => [call('del', 'delete_file', { path: lit(path) })],
  },
];

export const MOCK_SUPPORTED_REQUESTS = [
  "Read Bob's latest email, summarise it, and send the summary to Alice.",
  'Summarise https://example.org/post',
  'Summarise my private file contract.pdf',
  'Read brief.txt and email its summary to the project lead.',
  "Read Bob's latest email. If it is urgent, tell Alice, otherwise tell Carol.",
  "Show Bob's latest email.",
  'Delete the file notes.txt',
];

/**
 * @param {{ plans?: Record<string, object> }} [opts]
 *   plans: exact request text -> plan, for scenarios that bring their own plan
 */
export function createMockPlannerProvider({ plans = {} } = {}) {
  return {
    async plan({ request }) {
      if (Object.hasOwn(plans, request)) return structuredClone(plans[request]);
      const text = request.trim();
      for (const pattern of PATTERNS) {
        const match = pattern.re.exec(text);
        if (match) return { version: 1, steps: pattern.build({ ...match.groups }) };
      }
      throw new CannotPlan(
        'The demo planner only understands a few request shapes, for example: ' +
          MOCK_SUPPORTED_REQUESTS[0],
      );
    },
  };
}

// ---- Quarantined model ----------------------------------------------------------

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const STOP = new Set([
  'does',
  'this',
  'that',
  'email',
  'message',
  'mention',
  'mentions',
  'says',
  'say',
  'what',
  'which',
  'text',
  'with',
  'from',
]);

const flat = (s) => s.replace(/\s+/g, ' ').trim();

/** A deterministic, extractive stand-in: it copies, it does not reason. */
export function createMockQuarantineProvider() {
  return {
    async extract({ output, instruction, content }) {
      switch (output) {
        case 'text': {
          // First two sentences (a sentence ends at . ! or ? followed by a space), at most 300 characters.
          return flat(content)
            .split(/(?<=[.!?])\s+/)
            .slice(0, 2)
            .join(' ')
            .slice(0, 300);
        }
        case 'email':
          return content.match(EMAIL)?.[0] ?? '';
        case 'url':
          return content.match(/https?:\/\/[^\s"'<>)]+/i)?.[0] ?? '';
        case 'number':
          return Number(content.match(/-?\d+(?:\.\d+)?/)?.[0]);
        case 'boolean': {
          const words = (instruction ?? '').toLowerCase().match(/[a-z]{4,}/g) ?? [];
          const keys = words.filter((w) => !STOP.has(w));
          return keys.some((k) => content.toLowerCase().includes(k));
        }
        case 'list_of_text':
          return [...new Set(content.match(EMAIL) ?? [])].slice(0, 50);
        default:
          throw new Error('unsupported output');
      }
    },
  };
}
