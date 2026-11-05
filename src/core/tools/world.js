// The fake world the tools act on: a mailbox, contacts, files and web pages, plus
// a record of everything that "left the machine".
//
// Nothing here touches the real network or file system, so attacks can be
// replayed safely and evaluations are reproducible. Each run gets its own world,
// built from fixture data that is copied, never shared.
import { z } from 'zod';

const email = z.object({
  id: z.string().min(1),
  from: z.string().min(1), // address
  fromName: z.string().min(1),
  subject: z.string(),
  body: z.string(),
  date: z.string(),
});

export const fixtureSchema = z.object({
  contacts: z.array(z.object({ name: z.string().min(1), email: z.string().min(3) })),
  emails: z.array(email),
  files: z.array(
    z.object({
      path: z.string().min(1),
      content: z.string(),
      // Who may read it, and whether anyone outside could have written it.
      confidentiality: z.enum(['private', 'public']),
      trust: z.enum(['trusted', 'untrusted']).default('untrusted'),
    }),
  ),
  pages: z.array(z.object({ url: z.string().min(1), content: z.string() })),
});

/**
 * @typedef {{ kind: 'email' | 'fetch' | 'delete', target: string, payload?: string }} EgressRecord
 */

/** @param {unknown} fixtures validated against fixtureSchema */
export function createWorld(fixtures) {
  const data = fixtureSchema.parse(structuredClone(fixtures));
  return {
    contacts: data.contacts,
    emails: data.emails,
    files: new Map(data.files.map((f) => [f.path, f])),
    pages: new Map(data.pages.map((p) => [p.url, p])),
    /** Emails the user's agent sent. */
    outbox: [],
    /** Everything that left the machine, in order: sent mail, fetched URLs, deletions. */
    egress: /** @type {EgressRecord[]} */ ([]),
  };
}
