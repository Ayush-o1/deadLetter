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

/** Files (relative to src/) whose code mentions `name`, other than the ones allowed to. */
function usesOutside(name, allowed) {
  return sourceFiles(SRC)
    .filter((f) => new RegExp(`\\b${name}\\b`).test(code(f)))
    .map((f) => relative(SRC, f))
    .filter((f) => !allowed.includes(f));
}

test('only the policy gate can mint authorizations', () => {
  assert.deepEqual(
    usesOutside('mintAuthorization', ['core/policy/authorization.js', 'core/policy/gate.js']),
    [],
  );
});

test('only the tool invoker consumes authorizations', () => {
  assert.deepEqual(
    usesOutside('consumeAuthorization', ['core/policy/authorization.js', 'core/tools/invoke.js']),
    [],
  );
});

test('the interpreter reaches tools only through injected functions', () => {
  const text = code(join(SRC, 'core/interpreter/interpreter.js'));
  assert.doesNotMatch(
    text,
    /from\s+['"].*(tools\/invoke|policy\/gate|policy\/engine|authorization)/,
  );
});

test('model code cannot reach tools, the fake world, fixtures, values or the interpreter', () => {
  const forbidden =
    /from\s+['"][^'"]*(tools\/adapters|tools\/world|tools\/fixtures|tools\/invoke|labels\/provenance|labels\/value|interpreter\/|policy\/)/;
  const offenders = sourceFiles(join(SRC, 'core/models'))
    .filter((f) => forbidden.test(code(f)))
    .map((f) => relative(SRC, f));
  assert.deepEqual(offenders, []);
});

test('the fake tool adapters are only imported by wiring code, never by the engine', () => {
  const offenders = sourceFiles(join(SRC, 'core'))
    .filter((f) => !relative(SRC, f).startsWith('core/tools/'))
    .filter((f) => /tools\/(adapters|world|fixtures)/.test(code(f)))
    .map((f) => relative(SRC, f));
  assert.deepEqual(offenders, []);
});
