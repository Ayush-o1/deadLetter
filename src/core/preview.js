// Short text previews of values, for explanations, approval cards and the audit
// log. A preview is always truncated so no screen or log line carries a whole
// document, and whitespace is collapsed so it stays on one line.

/**
 * @param {{ data: unknown }} value
 * @param {number} [maxChars]
 */
export function previewValue(value, maxChars = 80) {
  const data = value.data;
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > maxChars ? `${flat.slice(0, Math.max(0, maxChars - 1))}…` : flat;
}
