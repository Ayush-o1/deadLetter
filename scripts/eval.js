// `npm run eval`: run every scenario against every defence and write the report.
// The output is deterministic: running it again gives byte-identical files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { runEvaluation } from '../src/eval/runner.js';
import { renderMarkdown } from '../src/eval/report.js';

const report = await runEvaluation();
const outDir = new URL('../reports/', import.meta.url);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL('eval-report.json', outDir), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(new URL('eval-report.md', outDir), `${renderMarkdown(report)}\n`);

console.log(renderMarkdown(report).split('\n## Every scenario')[0]);
console.log('Written to reports/eval-report.json and reports/eval-report.md');
