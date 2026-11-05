// The tools deadLetter knows about: names, what each argument is for, and what
// each tool can do to the world. The adapters that actually run them (fake,
// fixture-backed) are added in phase 5; policy decisions use only this metadata
// plus the labels of the arguments.
import { EFFECT, ROLE, defineCatalog } from './catalog.js';

export const toolCatalog = defineCatalog([
  {
    name: 'lookup_contact',
    title: 'Look up contact',
    effect: EFFECT.READ,
    namesRecipients: true,
    params: { name: { role: ROLE.SELECTOR } },
  },
  {
    name: 'read_email',
    title: 'Read email',
    effect: EFFECT.READ,
    params: {
      from: { role: ROLE.SELECTOR },
      which: { role: ROLE.PLAIN, required: false }, // "latest" by default
    },
  },
  {
    name: 'send_email',
    title: 'Send email',
    effect: EFFECT.SEND,
    params: {
      to: { role: ROLE.DESTINATION },
      subject: { role: ROLE.PLAIN },
      body: { role: ROLE.DATA },
    },
  },
  {
    name: 'read_file',
    title: 'Read file',
    effect: EFFECT.READ,
    params: { path: { role: ROLE.SELECTOR } },
  },
  {
    name: 'delete_file',
    title: 'Delete file',
    effect: EFFECT.DESTRUCTIVE,
    params: { path: { role: ROLE.SELECTOR } },
  },
  {
    // A GET request can carry data out in its URL, so the URL is a destination.
    name: 'fetch_url',
    title: 'Fetch web page',
    effect: EFFECT.READ,
    params: { url: { role: ROLE.DESTINATION } },
  },
]);
