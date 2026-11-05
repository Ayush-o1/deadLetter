// Turns an evaluation report into text. Pure formatting: every figure comes from
// the report object, and the report comes from executed runs.
const fmt = (n) => (n === null ? 'n/a' : `${n}%`);
const LABEL = {
  none: 'No defence',
  session_taint: 'Session taint',
  deadletter: 'deadLetter',
  deadletter_user_approves: 'deadLetter, worst case: user approves every prompt (attacks only)',
};

export function renderMarkdown(report) {
  const { meta, summary, scenarios } = report;
  const out = [];
  out.push('# deadLetter evaluation report', '');
  out.push(
    `Scenario set \`${meta.scenarioSet}\`: **${meta.scenarios} scenarios** (${meta.attacks} attacks, ${meta.benign} benign tasks).`,
    '',
  );

  out.push('## Summary', '');
  out.push(
    '| Defence | Attacks that succeeded | Attack success rate | Benign tasks completed | Completion rate | Needed approval | Private data leaked |',
  );
  out.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const [key, s] of Object.entries(summary)) {
    const benign = s.benign.total === 0 ? 'n/a' : `${s.benign.completed} / ${s.benign.total}`;
    out.push(
      `| ${LABEL[key] ?? key} | ${s.attacks.succeeded} / ${s.attacks.total} | ${fmt(s.attacks.successRatePercent)} | ${benign} | ${fmt(s.benign.completionRatePercent)} | ${s.benign.total === 0 ? 'n/a' : s.benign.neededApproval} | ${s.leaks} |`,
    );
  }
  out.push('');
  out.push(
    "Attack outcomes: *succeeded* (the attacker's goal was reached), *blocked* (a guard or the policy refused an action), *escalated* (put to the user, who rejected), *no path* (the defence never attempted the attacker's action).",
    '',
  );

  out.push('## Attacks that succeeded', '');
  for (const [key, s] of Object.entries(summary)) {
    if (s.attacks.total === 0) continue;
    out.push(
      `* **${LABEL[key] ?? key}**: ${s.attacks.succeededScenarios.length === 0 ? 'none' : s.attacks.succeededScenarios.map((id) => `\`${id}\``).join(', ')}`,
    );
  }
  out.push('');

  out.push('## Benign tasks that did not complete (false blocks and utility cost)', '');
  for (const [key, s] of Object.entries(summary)) {
    if (s.benign.total === 0) continue;
    const list = s.benign.falseBlocks.map((f) => `\`${f.scenarioId}\` (${f.reason})`);
    out.push(`* **${LABEL[key] ?? key}**: ${list.length === 0 ? 'none' : list.join(', ')}`);
  }
  out.push('');

  out.push('## Every scenario', '');
  out.push(
    '| Scenario | Kind | No defence | Session taint | deadLetter | deadLetter (user approves prompts) |',
  );
  out.push('| --- | --- | --- | --- | --- | --- |');
  const cell = (run) => {
    if (!run) return '-';
    if (run.kind === 'attack') return run.attackOutcome;
    return run.completed
      ? `completed${run.asks > 0 ? ` (${run.asks} prompt${run.asks > 1 ? 's' : ''})` : ''}`
      : `NOT completed: ${run.failureReason}`;
  };
  for (const row of scenarios) {
    const r = row.runs;
    out.push(
      `| \`${row.scenarioId}\` | ${row.kind} | ${cell(r.none)} | ${cell(r.session_taint)} | ${cell(r.deadletter)} | ${cell(r.deadletter_user_approves ?? (row.kind === 'benign' ? r.deadletter : undefined))} |`,
    );
  }
  out.push('');

  const notes = scenarios.filter((s) => s.note);
  if (notes.length > 0) {
    out.push('## Notes on specific scenarios', '');
    for (const s of notes) out.push(`* \`${s.scenarioId}\`: ${s.note}`);
    out.push('');
  }

  out.push('## How to read these numbers', '');
  for (const a of report.assumptions) out.push(`* ${a}`);
  out.push('');
  return out.join('\n');
}
