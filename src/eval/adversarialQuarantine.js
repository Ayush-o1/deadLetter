// The worst-case quarantined model, used for attack scenarios.
//
// It is not "fooled sometimes": it does whatever the attacker wants, whenever the
// text it reads contains the attacker's injection. For each requested output type
// it returns the attacker's preferred value of exactly that type. This is the
// strongest thing a quarantined model can do (it has no tools), so a result that
// holds against it holds against any weaker model too.
//
// If the injection is absent from the content, it behaves like the ordinary mock.
import { createMockQuarantineProvider } from '../core/models/providers/mock.js';

/**
 * @param {{ text: string, attackerAddress?: string, attackerUrl?: string, attackerText?: string } | null} attack
 */
export function createAdversarialQuarantine(attack) {
  const honest = createMockQuarantineProvider();
  return {
    async extract(job) {
      if (!attack || !job.content.includes(attack.text)) return honest.extract(job);
      switch (job.output) {
        case 'text':
          return attack.attackerText ?? attack.text;
        case 'email':
          return attack.attackerAddress ?? 'attacker@example.com';
        case 'url':
          return attack.attackerUrl ?? 'https://evil.example/x';
        case 'boolean':
          return true;
        case 'number':
          return 0;
        case 'list_of_text':
          return [attack.attackerAddress ?? 'attacker@example.com'];
        default:
          return honest.extract(job);
      }
    },
  };
}
