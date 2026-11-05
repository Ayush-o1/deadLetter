// Independent reference implementation of the label rules.
//
// It must NOT import anything from src/. It checks the production code by
// recomputing every label from scratch, using a different method:
//
//   production : each new value joins the labels of its inputs when created
//                (incremental, one level at a time, using Label objects)
//   reference  : for each value, collect ALL ancestors from the serialised
//                provenance graph and apply the definitions directly to plain
//                arrays and strings
//
// The definitions, stated once, in plain words (docs/POLICY_AND_LABELS.md):
//   * a value is trusted only if it and every ancestor was declared trusted
//   * a value is public only if it and every ancestor was declared public;
//     otherwise its readers are those principals named by every restricted
//     ancestor
//   * a value's sources are every source of itself and its ancestors
//
// Input graph format (see ProvenanceStore.toGraph):
//   { nodes: [{ id, intrinsic: {integrity, readers, sources},
//               label: {...}, parents: [id], controlDeps: [id] }] }
// where readers is the string "public" or an array of principal strings.

function ancestorsOrSelf(nodesById, startId) {
  const result = [];
  const seen = {};
  const todo = [startId];
  while (todo.length > 0) {
    const id = todo.pop();
    if (seen[id]) continue;
    seen[id] = true;
    const node = nodesById[id];
    if (!node) throw new Error(`graph references unknown node ${id}`);
    result.push(node);
    for (const dep of node.parents) todo.push(dep);
    for (const dep of node.controlDeps) todo.push(dep);
  }
  return result;
}

/** Expected label of one node, from first principles. */
export function referenceLabel(nodesById, id) {
  const group = ancestorsOrSelf(nodesById, id);

  let trusted = true;
  for (const n of group) if (n.intrinsic.integrity !== 'trusted') trusted = false;

  let readers = 'public';
  for (const n of group) {
    const r = n.intrinsic.readers;
    if (r === 'public') continue;
    readers = readers === 'public' ? [...r] : readers.filter((p) => r.includes(p));
  }
  if (readers !== 'public') readers = [...new Set(readers)].sort();

  const sources = [];
  for (const n of group)
    for (const s of n.intrinsic.sources) if (!sources.includes(s)) sources.push(s);
  sources.sort();

  return { integrity: trusted ? 'trusted' : 'untrusted', readers, sources };
}

/** Compare every node's recorded label with the reference. Returns the differences. */
export function findMismatches(graph) {
  const nodesById = {};
  for (const n of graph.nodes) nodesById[n.id] = n;

  const problems = [];
  for (const node of graph.nodes) {
    const expected = referenceLabel(nodesById, node.id);
    if (JSON.stringify(expected) !== JSON.stringify(node.label)) {
      problems.push({ id: node.id, expected, actual: node.label });
    }
  }
  return problems;
}
