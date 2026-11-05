// The fake tool adapters. This is where labels are decided for tool results.
//
// An adapter is trusted code: it knows what it fetched and how far that can be
// trusted. The rule it follows is the one in the product spec: anything the tool
// cannot vouch for is untrusted by default.
//
//   contact entries     trusted (the user's own data), public
//   email subject/body  untrusted (an outsider wrote it), private (the user's mailbox)
//   email sender        untrusted (can be spoofed), public (headers are not secret)
//   files               per fixture; untrusted unless the fixture says the user alone writes it
//   web pages           untrusted, public
//
// Adapters receive plain data (never labelled values) and return descriptions
// built with scalar()/record()/list(); the interpreter turns those into values.
import { z } from 'zod';
import { createLabel, list, record, restricted, scalar } from '../labels/index.js';

// Messages of a ToolError are shown to the user and saved in the audit log, so they
// must never quote an argument: the argument may be private text (a file name taken
// from a private note, a URL built from private data).
export class ToolError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolError';
  }
}

const text = z.string().min(1).max(2000);
const args = {
  lookup_contact: z.strictObject({ name: text }),
  read_email: z.strictObject({ from: text, which: z.enum(['latest', 'all']).optional() }),
  send_email: z.strictObject({
    to: z
      .string()
      .max(254)
      .regex(/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/, 'not an email address'),
    subject: z.string().max(500),
    body: z.string().max(20_000),
  }),
  read_file: z.strictObject({ path: text }),
  delete_file: z.strictObject({ path: text }),
  fetch_url: z.strictObject({
    url: z
      .string()
      .max(2000)
      .regex(/^https?:\/\//i, 'not a web address'),
  }),
};

function parse(tool, input) {
  const result = args[tool].safeParse(input);
  if (!result.success) {
    throw new ToolError(
      `Invalid arguments: ${result.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return result.data;
}

const norm = (s) => s.trim().toLowerCase();

/** @param {ReturnType<import('./world.js').createWorld>} world */
export function createFakeTools(world) {
  const mailLabel = (id, { secret }) =>
    createLabel({
      integrity: 'untrusted',
      readers: secret ? restricted([]) : undefined,
      sources: [`email:${id}`],
    });

  const emailRecord = (mail) =>
    record({
      id: scalar(mail.id, createLabel({ integrity: 'trusted', sources: [`email:${mail.id}`] })),
      from: scalar(mail.from, mailLabel(mail.id, { secret: false })),
      subject: scalar(mail.subject, mailLabel(mail.id, { secret: true })),
      body: scalar(mail.body, mailLabel(mail.id, { secret: true })),
      date: scalar(mail.date, mailLabel(mail.id, { secret: false })),
    });

  return {
    lookup_contact(input) {
      const { name } = parse('lookup_contact', input);
      const found = world.contacts.find(
        (c) => norm(c.name) === norm(name) || norm(c.email) === norm(name),
      );
      if (!found) throw new ToolError('No contact with that name');
      const label = createLabel({ integrity: 'trusted', sources: ['contacts'] });
      return record({ name: scalar(found.name, label), email: scalar(found.email, label) });
    },

    read_email(input) {
      const { from, which = 'latest' } = parse('read_email', input);
      const matches = world.emails
        .filter((m) => norm(m.from) === norm(from) || norm(m.fromName) === norm(from))
        .sort((a, b) => b.date.localeCompare(a.date));
      if (matches.length === 0) throw new ToolError('No email from that sender');
      return which === 'all' ? list(matches.map(emailRecord)) : emailRecord(matches[0]);
    },

    send_email(input) {
      const mail = parse('send_email', input);
      world.outbox.push({ ...mail });
      world.egress.push({
        kind: 'email',
        target: mail.to,
        payload: `${mail.subject}\n${mail.body}`,
      });
      return scalar('sent', createLabel({ integrity: 'trusted', sources: ['tool:send_email'] }));
    },

    read_file(input) {
      const { path } = parse('read_file', input);
      const file = world.files.get(path);
      if (!file) throw new ToolError('No such file');
      return scalar(
        file.content,
        createLabel({
          integrity: file.trust,
          readers: file.confidentiality === 'private' ? restricted([]) : undefined,
          sources: [`file:${path}`],
        }),
      );
    },

    delete_file(input) {
      const { path } = parse('delete_file', input);
      if (!world.files.delete(path)) throw new ToolError('No such file');
      world.egress.push({ kind: 'delete', target: path });
      return scalar(
        'deleted',
        createLabel({ integrity: 'trusted', sources: ['tool:delete_file'] }),
      );
    },

    fetch_url(input) {
      const { url } = parse('fetch_url', input);
      // The request itself leaves the machine, whether or not the page exists.
      world.egress.push({ kind: 'fetch', target: url });
      const page = world.pages.get(url);
      if (!page) throw new ToolError('The page could not be fetched (404)');
      return scalar(page.content, createLabel({ integrity: 'untrusted', sources: [`web:${url}`] }));
    },
  };
}
