# The plan language and the interpreter

The planner does not write code. It writes a **plan**: a small JSON document in a
language with five operations. The interpreter runs only what this document
describes. Source: `src/core/plan/` (language and validation) and
`src/core/interpreter/` (execution).

## Why not generated code?

Letting a model write JavaScript or Python and running it means trusting a very
large language, with every standard-library function as a possible exit. The
CaMeL paper uses a restricted subset of Python and its own interpreter; here the
plan is JSON checked by a strict schema. There is no parser to get wrong and
nothing to `eval`. A test fails the build if `eval`, `new Function` or
`child_process` appears anywhere in `src/`.

The price: the language cannot do arithmetic, define functions or manipulate
strings beyond joining them. The tasks in scope do not need any of that.

## Example

"Read Bob's latest email, summarise it, and send the summary to Alice."

```json
{
  "version": 1,
  "steps": [
    {
      "id": "s1",
      "op": "call",
      "tool": "lookup_contact",
      "args": { "name": { "lit": "Alice" } },
      "as": "alice"
    },
    {
      "id": "s2",
      "op": "call",
      "tool": "read_email",
      "args": { "from": { "lit": "Bob" } },
      "as": "mail"
    },
    {
      "id": "s3",
      "op": "quarantine",
      "task": "summarize",
      "input": { "ref": "mail", "path": ["body"] },
      "output": "text",
      "as": "summary"
    },
    {
      "id": "s4",
      "op": "call",
      "tool": "send_email",
      "args": {
        "to": { "ref": "alice", "path": ["email"] },
        "subject": { "lit": "Summary" },
        "body": { "ref": "summary" }
      }
    }
  ]
}
```

## Operations

| `op`         | Fields                                                  | Does                                                                    |
| ------------ | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `call`       | `tool`, `args`, optional `as`                           | calls a tool, after the policy gate                                     |
| `quarantine` | `task`, `input`, `output`, `as`, optional `instruction` | asks the quarantined model for one typed value; the result is untrusted |
| `show`       | `value`, optional `title`                               | puts a value in the results shown to the user                           |
| `if`         | `cond`, `then`, optional `else`                         | runs one block, depending on a true/false value                         |
| `for_each`   | `items`, `as`, `body`                                   | runs a block once per item of a list                                    |

`task` is `summarize` or `extract`. `output` is one of `text`, `boolean`,
`email`, `url`, `number`, `list_of_text`.

## Expressions

| Form                                         | Meaning                                    |
| -------------------------------------------- | ------------------------------------------ |
| `{"lit": "text"}` (or number, boolean, null) | a constant                                 |
| `{"ref": "mail", "path": ["body"]}`          | a variable, optionally a field of a record |
| `{"concat": [expr, expr]}`                   | text joined together                       |

## What a plan can never do

- **Choose a tool, operation or variable name from data.** `tool` is a string in
  the plan; an expression there is a schema error.
- **Contain unknown keys.** Every object is strict; `__proto__`, `constructor`
  and `prototype` anywhere in the input make the plan invalid (the schema
  library would otherwise silently drop them).
- **Name a destination the user did not write.** The _grounding rule_: a literal
  in a `destination` or `selector` argument (an address, URL, path, contact
  name) must appear verbatim, case-insensitively, in the user's request. See
  `docs/DECISIONS.md` D7.

## Validation (`validatePlan`)

Runs before anything executes and sees only the plan, the request and the tool
catalog. Errors are returned as a list of `{code, message, stepId}`:

| Code                                                                  | Meaning                                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `schema`                                                              | shape is wrong (unknown key, bad type, bad name, empty plan, wrong version) |
| `forbidden_key`                                                       | `__proto__`, `constructor`, `prototype` or a symbol key                     |
| `unknown_tool`, `unknown_argument`, `missing_argument`                | does not match the tool catalog                                             |
| `undefined_variable`, `variable_redefined`                            | scoping: single assignment, block-scoped                                    |
| `ungrounded_literal`                                                  | destination/selector literal not in the request                             |
| `duplicate_step_id`                                                   | ids must be unique                                                          |
| `too_many_steps`, `too_deep`, `too_many_loops`, `expression_too_deep` | limits                                                                      |

Limits: 60 steps, nesting depth 3, loop nesting 2, literals up to 2000
characters. Run-time limits: 25 iterations per loop (a longer list **fails** the
run rather than being silently truncated), 200 executed steps in total.

`runPlan` validates again itself, so there is no path to execution that skips it.

## How the interpreter runs a plan

The interpreter is a function with everything it needs passed in:

| Injected     | Role                                                                           |
| ------------ | ------------------------------------------------------------------------------ |
| `authorize`  | the policy gate; **must** answer `{outcome: 'execute'}` or the call is refused |
| `invokeTool` | the only way to reach a tool                                                   |
| `quarantine` | the quarantined model                                                          |
| `store`      | the provenance store; every value comes from here                              |
| `onEvent`    | progress and audit events                                                      |
| `signal`     | cancellation                                                                   |

For a `call` step: evaluate the arguments into labelled values → ask `authorize`
→ if and only if it answers `execute`, call `invokeTool` → wrap the result with
the labels the tool declares. **Anything other than an explicit `execute` is
treated as a refusal**, including `undefined`, a typo, or an exception.

For a `quarantine` step: the model receives `{task, instruction, output,
content}` and nothing else. Its answer must be exactly the requested type, and
then becomes an **untrusted** value whose parents include the input. A failure
or a wrong type stops the run. There is no retry and no fallback.

### Control flow

When entering an `if` or `for_each`, the condition (or list) value is pushed onto
a _control stack_. Two things follow:

1. every value created inside carries that value as a control dependency, so a
   value made under an untrusted condition is untrusted, and one made under a
   private condition is private;
2. every `authorize` call receives the control stack, so the policy engine can
   see that an action only runs because of an untrusted value.

The policy rule that uses this ("at least ask") is added in phase 4. The
interpreter itself never decides; it only makes the dependency visible.

Referencing an existing variable does not create a new value and does not change
its label. The dependency is carried by the control stack on calls instead.

### Events

`step_started`, `step_finished`, `step_blocked`, `step_failed`, `step_skipped`,
each with the step id, operation, tool and loop `iteration` indices. Steps that
never ran (after a block, failure or cancel, or in the branch not taken) are
reported as `step_skipped` with a reason. If the event sink throws, the run
stops: an action should not happen unrecorded.

### How a run ends

| Status         | When                                                                         |
| -------------- | ---------------------------------------------------------------------------- |
| `completed`    | every step ran                                                               |
| `blocked`      | the gate refused a call (deny, or a human rejected). Later steps are skipped |
| `failed`       | tool error, model failure or invalid model output, a limit, a bad reference  |
| `cancelled`    | the signal was aborted; no new step starts, finished steps stay finished     |
| `invalid_plan` | validation failed; nothing ran                                               |

A blocked or failed step stops the run (documented choice: later steps may depend
on the missing result, and continuing would mean running with a hole).
