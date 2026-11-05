// Helpers for the information-flow explorer: pick the part of a run's provenance
// graph that matters for one step. Pure functions over the saved graph (labels,
// previews and edges only; no full text).

/** The given nodes and everything they depend on (data and control edges). */
export function subgraph(nodes, rootIds) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const keep = new Set();
  const stack = [...rootIds].filter((id) => byId.has(id));
  while (stack.length > 0) {
    const id = stack.pop();
    if (keep.has(id)) continue;
    keep.add(id);
    const node = byId.get(id);
    for (const dep of [...node.parents, ...node.controlDeps]) stack.push(dep);
  }
  return nodes.filter((n) => keep.has(n.id));
}

/** Where each value was used as a tool argument, from the step records. */
export function usedBy(steps) {
  const uses = {};
  for (const step of steps) {
    for (const arg of step.args ?? []) {
      (uses[arg.valueId] ??= []).push({
        seq: step.seq,
        stepId: step.stepId,
        tool: step.tool,
        arg: arg.name,
      });
    }
  }
  return uses;
}

/**
 * The values that matter for one step: its arguments, input and conditions, and its
 * result for steps that produce a value of their own. A tool call's own result (for
 * example "sent") is left out: what matters about a call is what went into it.
 */
export function stepRoots(step) {
  return [
    ...(step.args ?? []).map((a) => a.valueId),
    ...(step.control ?? []).map((c) => c.valueId),
    ...(step.result && step.op !== 'call' ? [step.result.valueId] : []),
    ...(step.input ? [step.input.valueId] : []),
  ];
}
