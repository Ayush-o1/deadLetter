// The Value type. A value is data plus its label plus its history.
//
// Values are immutable and "minted": only provenance.js creates them (through
// mintValue), and isValue() recognises only minted ones. A plain object that
// merely looks like a value is rejected, so a model, a plan or a test cannot
// hand the interpreter a value with a convenient label.
//
// RULE (checked by test/security/architecture.test.js): nothing except
// provenance.js may import mintValue.

/**
 * @typedef {import('./label.js').Label} Label
 * @typedef {{ kind: 'literal' | 'tool' | 'derived', name: string }} Origin
 * @typedef {{ type: 'record', fields: Readonly<Record<string, Value>> }
 *         | { type: 'list', items: readonly Value[] }} Structure
 * @typedef {object} Value
 * @property {string} id            unique within one run, e.g. "v7"
 * @property {unknown} data         JSON data (deeply frozen)
 * @property {Label} label          the effective label, already joined with all ancestors
 * @property {Label} intrinsic      what this step added on its own (for leaves: the full label)
 * @property {readonly string[]} parents       ids of the values this one was computed from
 * @property {readonly string[]} controlDeps   ids of conditions this one was created under
 * @property {Origin} origin
 * @property {Structure | null} structure      record fields / list items, if composite
 */

const minted = new WeakSet();

/** Only provenance.js should call this. */
export function mintValue(fields) {
  const value = Object.freeze(fields);
  minted.add(value);
  return value;
}

/** True only for values created by a ProvenanceStore. */
export function isValue(candidate) {
  return minted.has(candidate);
}

/** Freeze nested arrays/objects so stored data cannot change after labelling. */
export function deepFreeze(data) {
  if (data !== null && typeof data === 'object' && !Object.isFrozen(data)) {
    Object.freeze(data);
    for (const key of Reflect.ownKeys(data)) deepFreeze(data[key]);
  }
  return data;
}
