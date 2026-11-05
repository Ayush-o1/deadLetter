// Structural guard rails, enforced by tests rather than by convention.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = new URL('../../src/', import.meta.url).pathname;

/** File contents with line comments removed, so a comment mentioning a name is not a use of it. */
const code = (file) => readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (path.includes(`${join('src', 'generated')}`)) return [];
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.js') ? [path] : [];
  });
}

test('only provenance.js may use mintValue (values cannot be forged elsewhere)', () => {
  const offenders = sourceFiles(SRC)
    .filter((f) => /\bmintValue\b/.test(code(f)))
    .map((f) => relative(SRC, f))
    .filter((f) => !['core/labels/value.js', 'core/labels/provenance.js'].includes(f));
  assert.deepEqual(offenders, []);
});

test('the labels index does not export mintValue', async () => {
  const api = await import('../../src/core/labels/index.js');
  assert.equal('mintValue' in api, false);
});

test('no source file evaluates generated code', () => {
  const banned = /\beval\s*\(|new\s+Function\s*\(|\bvm\.(runIn|Script)|child_process/;
  const offenders = sourceFiles(SRC)
    .filter((f) => banned.test(code(f)))
    .map((f) => relative(SRC, f));
  assert.deepEqual(offenders, []);
});

test('core/ does not import from the HTTP, database or runtime layers', () => {
  const offenders = sourceFiles(join(SRC, 'core'))
    .filter(
      (f) =>
        /from\s+['"](?:\.\.\/)+(?:http|db|runtime|eval)\//.test(readFileSync(f, 'utf8')) ||
        /from\s+['"](express|pg|@prisma)/.test(readFileSync(f, 'utf8')),
    )
    .map((f) => relative(SRC, f));
  assert.deepEqual(offenders, []);
});
