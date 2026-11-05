// The shape of a plan. This file is the whole "language definition".
//
// A plan is plain JSON. It is checked with strict schemas: any key that is not
// listed here makes the plan invalid, so there is no room to smuggle in extra
// behaviour. The planner (a language model) is not trusted to follow this
// shape; everything it returns passes through validatePlan().
//
// Deliberately NOT in the language: function definitions, arithmetic, string
// operations beyond concat, dynamic tool names, imports, or anything that
// builds a name out of data. A tool, an operation and a variable are always
// written literally in the plan.
import { z } from 'zod';

export const LIMITS = Object.freeze({
  maxSteps: 60, // steps in the whole plan, nested ones included
  maxDepth: 3, // nesting of if / for_each blocks
  maxLoopNesting: 2,
  maxLiteralLength: 2000,
  maxConcatParts: 10,
  maxExprDepth: 4,
  maxPathLength: 5,
  maxLoopIterations: 25, // enforced at run time
  maxExecutedSteps: 200, // enforced at run time
});

const RESERVED = new Set(['constructor', 'prototype', 'proto']);

const variableName = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,30}$/, 'variable names are lower_snake_case, up to 31 characters')
  .refine((v) => !RESERVED.has(v), 'reserved name');

const fieldName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,40}$/, 'field names are letters, digits and _')
  .refine((v) => !['__proto__', 'constructor', 'prototype'].includes(v), 'reserved name');

const stepId = z.string().regex(/^[A-Za-z0-9_]{1,20}$/, 'step ids are letters, digits and _');
const toolName = z.string().regex(/^[a-z][a-z0-9_]{0,30}$/, 'invalid tool name');

// ---- Expressions: the only way to write a value inside a plan ------------------
//   {"lit": "text"}                         a constant
//   {"ref": "mail", "path": ["body"]}       a variable, optionally one of its fields
//   {"concat": [expr, expr]}                text joined together
export const exprSchema = z.lazy(() =>
  z.union([
    z.strictObject({
      lit: z.union([
        z.string().max(LIMITS.maxLiteralLength),
        z.number().finite(),
        z.boolean(),
        z.null(),
      ]),
    }),
    z.strictObject({
      ref: variableName,
      path: z.array(fieldName).max(LIMITS.maxPathLength).optional(),
    }),
    z.strictObject({ concat: z.array(exprSchema).min(1).max(LIMITS.maxConcatParts) }),
  ]),
);

// ---- Steps ---------------------------------------------------------------------
export const QUARANTINE_TASKS = ['summarize', 'extract'];
export const QUARANTINE_OUTPUTS = ['text', 'boolean', 'email', 'url', 'number', 'list_of_text'];

const callStep = z.strictObject({
  id: stepId,
  op: z.literal('call'),
  tool: toolName, // a name written in the plan; no expression can produce one
  args: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/), exprSchema),
  as: variableName.optional(),
});

const quarantineStep = z.strictObject({
  id: stepId,
  op: z.literal('quarantine'),
  task: z.enum(QUARANTINE_TASKS),
  // Written by the (trusted) planner, never built from data.
  instruction: z.string().max(300).optional(),
  input: exprSchema,
  output: z.enum(QUARANTINE_OUTPUTS),
  as: variableName,
});

const showStep = z.strictObject({
  id: stepId,
  op: z.literal('show'),
  title: z.string().max(100).optional(),
  value: exprSchema,
});

export const stepSchema = z.lazy(() =>
  z.discriminatedUnion('op', [
    callStep,
    quarantineStep,
    showStep,
    z.strictObject({
      id: stepId,
      op: z.literal('if'),
      cond: exprSchema,
      then: z.array(stepSchema).min(1),
      else: z.array(stepSchema).optional(),
    }),
    z.strictObject({
      id: stepId,
      op: z.literal('for_each'),
      items: exprSchema,
      as: variableName,
      body: z.array(stepSchema).min(1),
    }),
  ]),
);

export const planSchema = z.strictObject({
  version: z.literal(1),
  steps: z.array(stepSchema).min(1),
});
