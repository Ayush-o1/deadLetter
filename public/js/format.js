// Words for things. All user-facing wording for statuses, decisions and labels
// lives here so it stays consistent across screens.

export const STATUS = {
  planning: { label: 'Planning', tone: 'neutral' },
  planned: { label: 'Ready to run', tone: 'info' },
  running: { label: 'Running', tone: 'info' },
  awaiting_approval: { label: 'Needs your decision', tone: 'ask' },
  completed: { label: 'Completed', tone: 'allow' },
  blocked: { label: 'Blocked', tone: 'deny' },
  failed: { label: 'Failed', tone: 'deny' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  interrupted: { label: 'Interrupted', tone: 'neutral' },
};
export const ACTIVE = new Set(['planning', 'running', 'awaiting_approval']);
export const FINISHED = new Set(['completed', 'blocked', 'failed', 'cancelled', 'interrupted']);

export const STEP_STATE = {
  waiting: 'Waiting',
  running: 'Running',
  done: 'Done',
  blocked: 'Blocked',
  needs_approval: 'Needs approval',
  failed: 'Failed',
  skipped: 'Not run',
  interrupted: 'Interrupted',
};

export const DECISION = {
  allow: { label: 'Allow', tone: 'allow' },
  ask: { label: 'Ask', tone: 'ask' },
  deny: { label: 'Deny', tone: 'deny' },
};

export const toolTitle = (name) =>
  name ? name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '';

export function timeAgo(iso, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function clock(iso) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** A label's sources as short human phrases. */
export function sourcePhrases(label) {
  const has = (p) => label.sources.some((s) => s === p || s.startsWith(`${p}:`));
  const out = [];
  if (has('email')) out.push('email');
  if (has('file')) out.push('file');
  if (has('web')) out.push('web page');
  if (has('contacts')) out.push('contacts');
  if (has('user_request')) out.push('your request');
  if (has('user_approval')) out.push('you (approval)');
  if (has('quarantine')) out.push('quarantined model');
  // An untrusted value inherits its inputs' sources, including trusted ones (your
  // request selected which email to read). Listing "your request" beside an
  // untrusted value would suggest you wrote it, so name only the outside origins.
  const outside = ['email', 'file', 'web page'];
  if (label.integrity === 'untrusted' && out.some((x) => outside.includes(x))) {
    return out.filter((x) => !['contacts', 'your request', 'you (approval)'].includes(x));
  }
  return out;
}

export function readersPhrase(label) {
  if (label.readers === 'public') return 'anyone';
  return label.readers.length === 0 ? 'only you' : `you and ${label.readers.join(', ')}`;
}

/** Two sentences explaining a label to a person. */
export function explainLabel(label) {
  const trust =
    label.integrity === 'trusted'
      ? 'Trusted: no untrusted text had a hand in making it.'
      : 'Untrusted: text from outside, or something made from it.';
  const who =
    label.readers === 'public'
      ? 'Not private: anyone may receive it.'
      : `Private: ${readersPhrase(label)} may receive it.`;
  return `${trust} ${who}`;
}
