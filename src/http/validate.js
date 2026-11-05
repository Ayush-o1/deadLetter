// Request validation. Every route parses its input with a zod schema before using it.
import { ZodError } from 'zod';
import { AppError } from './errors.js';

/** Parse `value` with `schema`, or throw a 400 that says what was wrong. */
export function parse(schema, value) {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) {
      const details = err.issues
        .slice(0, 8)
        .map((i) => ({ path: i.path.join('.'), message: i.message }));
      throw new AppError(400, 'validation_failed', 'The request is not valid', details);
    }
    throw err;
  }
}
