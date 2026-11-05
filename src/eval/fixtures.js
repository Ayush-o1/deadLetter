// Builds the world a scenario runs in: the seed dataset with the attacker's text
// placed in one location. The same function builds the "clean" world (no
// injection) for the clean-versus-attacked diff.
import { seedFixtures } from '../core/tools/fixtures/seed.js';

function place(original, injection, text) {
  switch (injection.position) {
    case 'prepend':
      return `${text} ${original}`;
    case 'append':
      return `${original} ${text}`;
    case 'replace':
      if (!original.includes(injection.find)) {
        throw new Error(`Injection text to replace was not found: "${injection.find}"`);
      }
      return original.replace(injection.find, text);
  }
}

/**
 * @param {object} scenario
 * @param {{ attacked?: boolean, text?: string }} [opts]
 *   attacked: include the injection (default true). text: override the injected wording.
 */
export function buildFixtures(scenario, { attacked = true, text } = {}) {
  const fixtures = structuredClone(seedFixtures);
  const inj = scenario.injection;
  if (inj && attacked) {
    const injected = text ?? inj.text;
    const t = inj.target;
    if (t.type === 'email') {
      const mail = fixtures.emails.find((m) => m.id === t.id);
      mail.body = place(mail.body, inj, injected);
    } else if (t.type === 'file') {
      const file = fixtures.files.find((f) => f.path === t.path);
      file.content = place(file.content, inj, injected);
    } else {
      const page = fixtures.pages.find((p) => p.url === t.url);
      page.content = place(page.content, inj, injected);
    }
  }
  return fixtures;
}
