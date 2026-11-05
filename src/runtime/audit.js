// What the audit log is allowed to keep about a value.
//
// A log full of private text would itself be a place to leak from, so records
// hold LABELS, SOURCES and SHORT PREVIEWS, never whole documents. The more
// sensitive a value, the shorter its preview:
//
//                              public / not private     private (readers restricted)
//   destination, selector      up to 120 characters     up to 60  (an address or path
//                                                         identifies the action)
//   content (data, plain)      up to 60                 up to 24
//   result shown to the user   up to 300                up to 120
//
// All redaction happens in this one file, so it is easy to check and to test.
import { isPrivate, serializeLabel } from '../core/labels/index.js';
import { previewValue } from '../core/preview.js';

const LIMITS = Object.freeze({
  target: { open: 120, private: 60 },
  content: { open: 60, private: 24 },
  result: { open: 300, private: 120 },
});

const bucket = (role) => (role === 'destination' || role === 'selector' ? 'target' : 'content');
const limitFor = (kind, value) => LIMITS[kind][isPrivate(value.label) ? 'private' : 'open'];

/** Short preview of an argument or intermediate value. */
export function auditPreview(value, role = 'plain') {
  return previewValue(value, limitFor(bucket(role), value));
}

/** Bounded preview of something shown to the user as a result. */
export function resultPreview(value) {
  const max = limitFor('result', value);
  const full = typeof value.data === 'string' ? value.data : JSON.stringify(value.data);
  return { preview: previewValue(value, max), truncated: String(full).length > max };
}

/** How one tool argument appears in a step record. */
export function describeArg(name, role, value) {
  return {
    name,
    role,
    valueId: value.id,
    label: serializeLabel(value.label),
    origin: { ...value.origin },
    preview: auditPreview(value, role),
  };
}

export function describeControl(value) {
  return { valueId: value.id, label: serializeLabel(value.label), preview: auditPreview(value) };
}

/**
 * The provenance graph with a redacted preview on each node, for the
 * information-flow explorer. Edges and labels come from the store; data never
 * does.
 */
export function buildFlowGraph(store, roots) {
  const graph = store.toGraph(roots);
  return {
    nodes: graph.nodes.map((node) => ({ ...node, preview: auditPreview(store.get(node.id)) })),
  };
}
