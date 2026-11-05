// Labels: the facts attached to every value (docs/POLICY_AND_LABELS.md).
//
//   integrity  'trusted' | 'untrusted'   did untrusted text have a hand in making it?
//   readers    public | restricted(set)  who may receive it?
//   sources    names of the origins      "email:msg-2", "user_request", ...
//
// Labels form a lattice where "more restrictive" means: untrusted instead of
// trusted, a smaller reader set instead of a larger one, and more sources.
// `joinLabels` is the only way two labels combine, and it can only move up the
// lattice. There is deliberately NO function that makes a label less
// restrictive (no "declassify", no "mark trusted"). Anything that needs to
// relax a restriction, such as "the user named this recipient", is a decision
// made by the policy engine about a call, never an edit to a label.

export const TRUSTED = 'trusted';
export const UNTRUSTED = 'untrusted';

/**
 * @typedef {{ kind: 'public' } | { kind: 'restricted', principals: readonly string[] }} Readers
 * @typedef {{ integrity: 'trusted' | 'untrusted', readers: Readers, sources: readonly string[] }} Label
 */

/** Principals are compared case-insensitively (email addresses). */
export function normalizePrincipal(principal) {
  if (typeof principal !== 'string' || principal.trim() === '') {
    throw new TypeError('A principal must be a non-empty string');
  }
  return principal.trim().toLowerCase();
}

/** Anyone may receive the value. */
export const PUBLIC = Object.freeze({ kind: 'public' });

/**
 * Only the listed principals (plus the user, who is implicit) may receive the
 * value. `restricted([])` means "the user only".
 * @param {string[]} [principals]
 * @returns {Readers}
 */
export function restricted(principals = []) {
  const unique = [...new Set(principals.map(normalizePrincipal))].sort();
  return Object.freeze({ kind: 'restricted', principals: Object.freeze(unique) });
}

/** Re-validate a readers object so a hand-built or tampered one cannot slip in. */
function normalizeReaders(readers) {
  if (readers?.kind === 'public') return PUBLIC;
  if (readers?.kind === 'restricted' && Array.isArray(readers.principals)) {
    return restricted(readers.principals);
  }
  throw new TypeError('readers must be PUBLIC or restricted([...])');
}

/**
 * Create a label. Used only by trusted code: tool adapters and the interpreter.
 * @param {{ integrity: string, readers?: Readers, sources?: string[] }} parts
 * @returns {Label}
 */
export function createLabel({ integrity, readers = PUBLIC, sources = [] }) {
  if (integrity !== TRUSTED && integrity !== UNTRUSTED) {
    throw new TypeError(`integrity must be "${TRUSTED}" or "${UNTRUSTED}"`);
  }
  if (!Array.isArray(sources) || sources.some((s) => typeof s !== 'string' || s === '')) {
    throw new TypeError('sources must be an array of non-empty strings');
  }
  return Object.freeze({
    integrity,
    readers: normalizeReaders(readers),
    sources: Object.freeze([...new Set(sources)].sort()),
  });
}

/** The neutral label: joining it with anything changes nothing. */
export const IDENTITY = createLabel({ integrity: TRUSTED, readers: PUBLIC, sources: [] });

/**
 * Label for anything produced by the quarantined model: always untrusted,
 * whatever it was given. The task name is recorded as a source.
 * @param {string} task
 */
export function quarantineLabel(task) {
  return createLabel({ integrity: UNTRUSTED, sources: [`quarantine:${task}`] });
}

/** Readers allowed to receive both a value and another: the intersection. */
export function intersectReaders(a, b) {
  if (a.kind === 'public') return b;
  if (b.kind === 'public') return a;
  return restricted(a.principals.filter((p) => b.principals.includes(p)));
}

/**
 * Combine labels. The result is untrusted if any input is, may be received only
 * by principals every input allows, and remembers every source.
 * @param {...Label} labels
 * @returns {Label}
 */
export function joinLabels(...labels) {
  let integrity = TRUSTED;
  let readers = PUBLIC;
  const sources = [];
  for (const label of labels) {
    if (label.integrity === UNTRUSTED) integrity = UNTRUSTED;
    readers = intersectReaders(readers, label.readers);
    sources.push(...label.sources);
  }
  return createLabel({ integrity, readers, sources });
}

export const isTrusted = (label) => label.integrity === TRUSTED;

/** A value is private when it is not readable by everyone. */
export const isPrivate = (label) => label.readers.kind !== 'public';

/** May `principal` receive a value with this label? (The user always may.) */
export function canReceive(label, principal) {
  if (label.readers.kind === 'public') return true;
  return label.readers.principals.includes(normalizePrincipal(principal));
}

/**
 * Is `a` at least as restrictive as `b`? Used as a safety net: a derived value
 * must always satisfy this against each of its inputs.
 */
export function atLeastAsRestrictive(a, b) {
  if (b.integrity === UNTRUSTED && a.integrity !== UNTRUSTED) return false;
  if (b.readers.kind === 'restricted') {
    if (a.readers.kind !== 'restricted') return false;
    if (!a.readers.principals.every((p) => b.readers.principals.includes(p))) return false;
  }
  return b.sources.every((s) => a.sources.includes(s));
}

/** Plain-JSON form used in audit records, the flow graph and the reference checker. */
export function serializeLabel(label) {
  return {
    integrity: label.integrity,
    readers: label.readers.kind === 'public' ? 'public' : [...label.readers.principals],
    sources: [...label.sources],
  };
}

export function labelsEqual(a, b) {
  return JSON.stringify(serializeLabel(a)) === JSON.stringify(serializeLabel(b));
}
