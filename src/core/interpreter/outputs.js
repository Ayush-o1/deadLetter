// The quarantined model's answer is checked against the type the plan asked for.
//
// This is a security boundary: the model may be fooled by the text it reads, so
// its output is treated as hostile data. Only a value of exactly the requested
// type gets through; it then becomes an untrusted Value. Nothing in the answer
// can carry a label, a tool name or an instruction, because only the bare
// value is read.
import { z } from 'zod';

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

const schemas = {
  text: z.string().max(10_000),
  boolean: z.boolean(),
  email: z.string().max(254).regex(EMAIL),
  url: z
    .string()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u) && URL.canParse(u)),
  number: z.number().finite(),
  list_of_text: z.array(z.string().max(500)).max(50),
};

/**
 * @param {string} kind one of the plan's output types
 * @param {unknown} raw whatever the model returned
 * @returns {{ ok: true, value: unknown } | { ok: false }}
 */
export function parseQuarantineOutput(kind, raw) {
  const schema = schemas[kind];
  if (!schema) return { ok: false };
  const result = schema.safeParse(raw);
  return result.success ? { ok: true, value: result.data } : { ok: false };
}
