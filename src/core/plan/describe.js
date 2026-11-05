// Plan preview: the plan as short plain-language steps, shown before anything
// runs. Pure text generation from the plan and the tool catalog; no model is
// involved, so the preview cannot say anything the plan does not contain.

function exprText(expr) {
  if ('lit' in expr) return JSON.stringify(expr.lit);
  if ('ref' in expr) return [expr.ref, ...(expr.path ?? [])].join('.');
  return expr.concat.map(exprText).join(' + ');
}

const TASK_VERB = { summarize: 'summarise', extract: 'extract from' };
const OUTPUT_NOUN = {
  text: 'text',
  boolean: 'a yes/no answer',
  email: 'an email address',
  url: 'a web address',
  number: 'a number',
  list_of_text: 'a list of text items',
};

/**
 * @param {{ steps: object[] }} plan a validated plan
 * @param {ReturnType<import('../tools/catalog.js').defineCatalog>} catalog
 * @returns {{ id: string, depth: number, text: string, kind: string }[]}
 */
export function describePlan(plan, catalog) {
  const lines = [];

  function walk(steps, depth) {
    for (const step of steps) {
      const saved = step.as ? ` → ${step.as}` : '';
      switch (step.op) {
        case 'call': {
          const tool = catalog.get(step.tool);
          const args = Object.entries(step.args)
            .map(([k, v]) => `${k} = ${exprText(v)}`)
            .join(', ');
          const note =
            tool?.effect === 'read' ? '' : ` (${tool?.effect ?? 'unknown'}; checked by policy)`;
          lines.push({
            id: step.id,
            depth,
            kind: 'call',
            text: `${tool?.title ?? step.tool}: ${args}${saved}${note}`,
          });
          break;
        }
        case 'quarantine':
          lines.push({
            id: step.id,
            depth,
            kind: 'quarantine',
            text:
              `Ask the quarantined model to ${TASK_VERB[step.task]} ${exprText(step.input)} ` +
              `and return ${OUTPUT_NOUN[step.output]}${step.instruction ? ` (${step.instruction})` : ''}` +
              `${saved}. The result is untrusted.`,
          });
          break;
        case 'show':
          lines.push({
            id: step.id,
            depth,
            kind: 'show',
            text: `Show you ${exprText(step.value)}`,
          });
          break;
        case 'if':
          lines.push({
            id: step.id,
            depth,
            kind: 'if',
            text: `If ${exprText(step.cond)} is true:`,
          });
          walk(step.then, depth + 1);
          if (step.else) {
            lines.push({ id: `${step.id}_else`, depth, kind: 'else', text: 'Otherwise:' });
            walk(step.else, depth + 1);
          }
          break;
        case 'for_each':
          lines.push({
            id: step.id,
            depth,
            kind: 'for_each',
            text: `For each ${step.as} in ${exprText(step.items)}:`,
          });
          walk(step.body, depth + 1);
          break;
      }
    }
  }

  walk(plan.steps, 0);
  return lines;
}
