// Builders for values with specific labels, as the real components would create them.
import { ProvenanceStore, createLabel, restricted, scalar } from '../../src/core/labels/index.js';
import { toolCatalog } from '../../src/core/tools/specs.js';
import { defaultPolicyConfig, parsePolicyConfig } from '../../src/core/policy/config.js';

export function makeWorld() {
  const store = new ProvenanceStore();
  const v = {
    store,
    /** An address the user typed in the request: trusted, public, named by the user. */
    typed: (text) => store.literal(text, { source: 'user_request' }),
    /** An address from the user's contacts. */
    contact: (text) =>
      store.fromTool(scalar(text, createLabel({ integrity: 'trusted', sources: ['contacts'] })), {
        tool: 'lookup_contact',
      }),
    /** Text from outside: untrusted, public. */
    outsidePublic: (text, source = 'web:page') =>
      store.fromTool(scalar(text, createLabel({ integrity: 'untrusted', sources: [source] })), {
        tool: 'fetch_url',
      }),
    /** Text from the user's mailbox/files: untrusted and readable by the listed principals only. */
    outsidePrivate: (text, readers = [], source = 'email:msg-2') =>
      store.fromTool(
        scalar(
          text,
          createLabel({ integrity: 'untrusted', readers: restricted(readers), sources: [source] }),
        ),
        { tool: 'read_email' },
      ),
    /** The user's own text, private. */
    ownPrivate: (text, readers = []) =>
      store.fromTool(
        scalar(
          text,
          createLabel({
            integrity: 'trusted',
            readers: restricted(readers),
            sources: ['file:notes'],
          }),
        ),
        { tool: 'read_file' },
      ),
    /** Public trusted text that came from a tool, not from the user's request. */
    trustedFromFile: (text) =>
      store.fromTool(
        scalar(text, createLabel({ integrity: 'trusted', sources: ['file:addressbook'] })),
        { tool: 'read_file' },
      ),
    plainLiteral: (text) => store.literal(text, { source: 'plan' }),
  };
  return v;
}

export function configWith(overrides = {}, trusted = []) {
  const base = defaultPolicyConfig(toolCatalog);
  const merged = {
    tools: { ...base.tools, ...overrides },
    trustedDestinations: trusted,
  };
  const parsed = parsePolicyConfig(merged);
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.config;
}
