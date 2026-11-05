# Labels and provenance

This document describes what is implemented in `src/core/labels/`. The policy
engine that reads these labels is built in phase 4; its section is added then.

## What a label says

Every value carries a label with three parts.

| Part        | Values                                      | Question it answers                            |
| ----------- | ------------------------------------------- | ---------------------------------------------- |
| `integrity` | `trusted` or `untrusted`                    | Did untrusted text have a hand in making this? |
| `readers`   | `public`, or `restricted(principals)`       | Who may receive it?                            |
| `sources`   | names such as `email:msg-2`, `user_request` | Where did it come from? (for explanations)     |

`restricted([])` means "the user only". The user can always see their own data,
so they are not listed. Principals (email addresses) are compared in lower case.

Examples from the product spec:

| Value                                 | integrity   | readers          | sources                                                 |
| ------------------------------------- | ----------- | ---------------- | ------------------------------------------------------- |
| `alice@example.com` typed by the user | `trusted`   | `public`         | `user_request`                                          |
| Body of Bob's email                   | `untrusted` | `restricted([])` | `email:msg-2`                                           |
| Summary made from that body           | `untrusted` | `restricted([])` | `email:msg-2`, `quarantine:summarize`                   |
| An address found in the email body    | `untrusted` | `public`         | `email:msg-2` (after extraction: also `quarantine:...`) |

## How labels combine

One operation, `joinLabels`, and it can only make things stricter.

| Part        | Rule                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `integrity` | untrusted if **any** input is untrusted                                                                                 |
| `readers`   | the **intersection** of the inputs' readers (`public` ∩ X = X; two disjoint sets give `restricted([])`, never `public`) |
| `sources`   | the union                                                                                                               |

Properties, each checked by tests on thousands of random labels: join is
commutative, associative and idempotent; the result is always at least as
restrictive as every input; the neutral label `IDENTITY` (trusted, public, no
sources) changes nothing.

### There is no way to relax a label

The module has no "declassify", no "mark trusted", no "add reader". This is
intentional. When the user names a recipient, that is not an edit to the data's
label; it is a fact the policy engine uses when judging one call (phase 4).
Keeping that out of the label code means no bug in the label code can ever make
a value more trusted than its history allows.

## Values and provenance

A `Value` is `{ id, data, label, intrinsic, parents, controlDeps, origin, structure }`.

- `intrinsic` is what that step added by itself. For a tool result it is the
  full label the tool declared. For a derived value it is usually `IDENTITY`,
  except for model output, which adds `quarantineLabel(task)` (untrusted).
- `label` is the **effective** label: the join of `intrinsic`, all `parents` and
  all `controlDeps`.
- `parents` are the values it was computed from. `controlDeps` are the
  conditions it was created under (see below).
- `structure` makes a value a **record** (named fields) or **list** (items). Each
  field or item is its own value with its own label, so `email.body` can be
  untrusted and private while `contact.email` is trusted and public. The record
  as a whole has the join of its fields.

Values are frozen. Their data is copied on the way in and deeply frozen.

### Who can create what

All values are created by a per-run `ProvenanceStore`:

| Method                         | Used by                | Label                                                |
| ------------------------------ | ---------------------- | ---------------------------------------------------- |
| `literal(data, {source})`      | interpreter            | trusted, public; `source` = `user_request` or `plan` |
| `fromTool(spec, {tool})`       | tool adapters' results | exactly what the adapter declares (re-validated)     |
| `derive({parents, op, extra})` | interpreter            | **computed**: join of parents, control, `extra`      |

Only `literal` and `fromTool` declare a label. `derive` takes no label to copy;
`extra` can only add restrictions because it is joined in. The store also checks
after each creation that the new label is at least as restrictive as every input
and throws if not.

The model-facing code (planner, quarantined model) never receives the store.
`isValue` accepts only values the store minted, and a test fails if any file
other than `provenance.js` uses the minting function.

### Control dependencies

When a value is created while the interpreter is inside an `if` or `for_each`,
the condition's value is passed as `control`. It is recorded in `controlDeps` and
joined into the label. Consequences, by design:

- a value created under an untrusted condition is untrusted;
- a value created under a private condition is private (which branch ran can
  reveal the condition);
- the provenance graph shows the dependency, so the flow explorer can draw it.

The interpreter (phase 3) and the policy engine (phase 4) use this for
control-flow protection.

## Provenance graph

`store.toGraph(roots?)` returns plain JSON: for each value, its id, origin,
intrinsic and effective label, parents, control dependencies and structure. It
contains **no data**, so it is safe to store and to draw (phase 10), and a test
checks that a secret string in a value never appears in it.

## Independent verification

`test/reference/labelChecker.js` imports nothing from `src/`. For each value it
collects every ancestor from the serialised graph and applies the definitions
directly to arrays (trusted only if all ancestors trusted; readers are those
named by every restricted ancestor; sources are the union). The production code
works the other way round: it joins one level at a time as values are created.
`test/unit/labelConsistency.test.js` builds 1000 random graphs, using every
creation path, and requires the two to agree on every value. A second test checks the
invariants (nothing laundered, nothing widened, no source lost) without using
either implementation. A third tampers with labels and requires the checker to
notice, so the checker is known to be able to fail.

What this does and does not show: it catches mistakes in the label code. It
cannot catch a wrong assumption about a source, such as a tool labelling content
an outsider can edit as trusted (see the threat model).

## Policy

Added in phase 4. The planned matrix is in
[ARCHITECTURE.md](ARCHITECTURE.md#3-the-policy-matrix-for-outbound-tools).
