// ProvenanceStore: creates every Value of a run and remembers how it was made.
//
// Three rules make labels trustworthy here:
//   1. Values can only be created through this class.
//   2. A derived value's label is COMPUTED (join of its inputs, its control
//      context and what the step itself adds). Callers cannot pass a label in.
//   3. After computing, the store checks the result is at least as restrictive
//      as every input and throws if not. This is a second line of defence
//      against bugs in the join; the independent reference checker is the third.
//
// Leaves (literals and tool results) are the only places a label is *declared*.
// They are created by the interpreter and by tool adapters, both trusted code.
import {
  IDENTITY,
  PUBLIC,
  TRUSTED,
  atLeastAsRestrictive,
  createLabel,
  joinLabels,
  serializeLabel,
} from './label.js';
import { deepFreeze, isValue, mintValue } from './value.js';

// ---- Tool result descriptions -------------------------------------------------
// Tool adapters describe what they return with these helpers. Each leaf carries
// the label the adapter vouches for.

/** A single piece of data with an adapter-declared label. */
export const scalar = (data, label) => ({ kind: 'scalar', data, label });
/** A record whose fields each have their own label. */
export const record = (fields) => ({ kind: 'record', fields });
/** A list whose items each have their own label. */
export const list = (items) => ({ kind: 'list', items });

const seqOf = (id) => Number(id.slice(1));

export class ProvenanceStore {
  /** @type {Map<string, import('./value.js').Value>} */
  #values = new Map();
  #seq = 0;

  /** All values passed in must have been created by this store. */
  #owned(values, what) {
    if (!Array.isArray(values)) throw new TypeError(`${what} must be an array of values`);
    for (const v of values) {
      if (!isValue(v) || this.#values.get(v.id) !== v) {
        throw new TypeError(`${what} contains something that is not a value of this run`);
      }
    }
    return values;
  }

  #add({ data, intrinsic, parents, control, origin, structure }) {
    const label = joinLabels(
      intrinsic,
      ...parents.map((p) => p.label),
      ...control.map((c) => c.label),
    );
    for (const input of [...parents, ...control]) {
      if (!atLeastAsRestrictive(label, input.label)) {
        throw new Error(`Internal error: label of a new value is weaker than input ${input.id}`);
      }
    }
    const id = `v${++this.#seq}`;
    const value = mintValue({
      id,
      data: deepFreeze(data),
      label,
      intrinsic,
      parents: Object.freeze(parents.map((p) => p.id)),
      controlDeps: Object.freeze(control.map((c) => c.id)),
      origin: Object.freeze(origin),
      structure,
    });
    this.#values.set(id, value);
    return value;
  }

  /**
   * A constant written into the plan. Trusted and public, with `source` saying
   * where the text really came from ("user_request" when it appears in the
   * user's request, otherwise "plan").
   *
   * `control` is the list of conditions currently being branched on. A literal
   * created inside an untrusted `if` is itself untrusted: it exists only because
   * of that condition.
   */
  literal(data, { source, control = [] }) {
    if (typeof source !== 'string' || source === '') throw new TypeError('literal needs a source');
    return this.#add({
      data: structuredClone(data),
      intrinsic: createLabel({ integrity: TRUSTED, readers: PUBLIC, sources: [source] }),
      parents: [],
      control: this.#owned(control, 'control'),
      origin: { kind: 'literal', name: source },
      structure: null,
    });
  }

  /**
   * Turn a tool adapter's description of its result into values.
   * @param {object} spec built with scalar(), record() or list()
   * @param {{ tool: string, control?: object[], inputs?: object[] }} opts
   *   `inputs` are the argument values the tool was called with. A result
   *   inherits their labels: if an untrusted value chose which contact or file
   *   to look up, what comes back is not trustworthy either.
   */
  fromTool(spec, { tool, control = [], inputs = [] }) {
    const ctl = this.#owned(control, 'control');
    const inp = this.#owned(inputs, 'inputs');
    const build = (s) => {
      switch (s?.kind) {
        case 'scalar':
          return this.#add({
            data: structuredClone(s.data),
            // createLabel re-validates, so an adapter cannot pass a malformed label.
            intrinsic: createLabel({
              integrity: s.label.integrity,
              readers: s.label.readers,
              sources: [...s.label.sources],
            }),
            parents: inp,
            control: ctl,
            origin: { kind: 'tool', name: tool },
            structure: null,
          });
        case 'record': {
          // Null prototype: a field called "__proto__" is just a field.
          const fields = Object.create(null);
          for (const [name, child] of Object.entries(s.fields)) fields[name] = build(child);
          const children = Object.values(fields);
          return this.#add({
            data: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.data])),
            intrinsic: IDENTITY,
            parents: children,
            control: ctl,
            origin: { kind: 'tool', name: tool },
            structure: Object.freeze({ type: 'record', fields: Object.freeze(fields) }),
          });
        }
        case 'list': {
          const items = s.items.map(build);
          return this.#add({
            data: items.map((v) => v.data),
            intrinsic: IDENTITY,
            parents: items,
            control: ctl,
            origin: { kind: 'tool', name: tool },
            structure: Object.freeze({ type: 'list', items: Object.freeze(items) }),
          });
        }
        default:
          throw new TypeError('tool result must be built with scalar(), record() or list()');
      }
    };
    return build(spec);
  }

  /**
   * A value computed from other values. Its label is the join of the parents'
   * labels, the control context, and `extra` (what this step adds, such as the
   * "untrusted" label of quarantined-model output). There is no way to pass a
   * weaker label.
   *
   * @param {{ data: unknown, parents: object[], op: string,
   *           extra?: import('./label.js').Label, control?: object[] }} args
   */
  derive({ data, parents, op, extra = IDENTITY, control = [] }) {
    const owned = this.#owned(parents, 'parents');
    if (owned.length === 0) {
      throw new TypeError('derive needs at least one parent; use literal() for constants');
    }
    return this.#add({
      data: structuredClone(data),
      intrinsic: createLabel({
        integrity: extra.integrity,
        readers: extra.readers,
        sources: [...extra.sources],
      }),
      parents: owned,
      control: this.#owned(control, 'control'),
      origin: { kind: 'derived', name: op },
      structure: null,
    });
  }

  /**
   * Gather existing values into a list value (for example the items extracted by
   * the quarantined model). The list's label is the join of its items.
   */
  collect(items, { control = [] } = {}) {
    const owned = this.#owned(items, 'items');
    return this.#add({
      data: owned.map((v) => v.data),
      intrinsic: IDENTITY,
      parents: owned,
      control: this.#owned(control, 'control'),
      origin: { kind: 'derived', name: 'collect' },
      structure: Object.freeze({ type: 'list', items: Object.freeze([...owned]) }),
    });
  }

  /** Field `name` of a record value. Returns the field's own value and label. */
  field(recordValue, name) {
    this.#owned([recordValue], 'record');
    const structure = recordValue.structure;
    if (structure?.type !== 'record') throw new TypeError(`${recordValue.id} is not a record`);
    if (!Object.hasOwn(structure.fields, name)) {
      throw new TypeError(`${recordValue.id} has no field "${name}"`);
    }
    return structure.fields[name];
  }

  /** The items of a list value, each with its own label. */
  items(listValue) {
    this.#owned([listValue], 'list');
    if (listValue.structure?.type !== 'list') throw new TypeError(`${listValue.id} is not a list`);
    return listValue.structure.items;
  }

  get(id) {
    return this.#values.get(id);
  }

  get size() {
    return this.#values.size;
  }

  /** Ids of every value `id` depends on (data and control), nearest first is not guaranteed; sorted by creation. */
  ancestors(id) {
    const seen = new Set();
    const stack = [id];
    while (stack.length > 0) {
      const current = this.#values.get(stack.pop());
      if (!current) throw new Error(`Unknown value ${id}`);
      for (const dep of [...current.parents, ...current.controlDeps]) {
        if (!seen.has(dep)) {
          seen.add(dep);
          stack.push(dep);
        }
      }
    }
    return [...seen].sort((a, b) => seqOf(a) - seqOf(b));
  }

  /**
   * The provenance graph as plain JSON: labels, origins and edges, but no data,
   * so it is safe to store and to draw. With `roots`, only those values and
   * their ancestors are included.
   */
  toGraph(roots) {
    let ids;
    if (roots) {
      ids = new Set(roots);
      for (const r of roots) for (const a of this.ancestors(r)) ids.add(a);
    } else {
      ids = new Set(this.#values.keys());
    }
    const nodes = [...ids]
      .sort((a, b) => seqOf(a) - seqOf(b))
      .map((id) => {
        const v = this.#values.get(id);
        const s = v.structure;
        return {
          id,
          origin: { ...v.origin },
          intrinsic: serializeLabel(v.intrinsic),
          label: serializeLabel(v.label),
          parents: [...v.parents],
          controlDeps: [...v.controlDeps],
          structure: s
            ? s.type === 'record'
              ? {
                  type: 'record',
                  fields: Object.fromEntries(Object.entries(s.fields).map(([k, c]) => [k, c.id])),
                }
              : { type: 'list', items: s.items.map((c) => c.id) }
            : null,
        };
      });
    return { nodes };
  }
}
