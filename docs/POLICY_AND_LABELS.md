# Labels and provenance

This document describes what is implemented in `src/core/labels/` (labels and
provenance) and `src/core/policy/` (the policy engine that reads them).

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

### A tool's result inherits its arguments' labels

If an untrusted value chose which contact to look up, the address that comes back
was effectively chosen by untrusted text, even though the contacts database is
the user's own. So the interpreter passes the call's arguments as `inputs`, and
the result's label is the join of what the adapter declares and what the
arguments carry. A result selected by trusted literals keeps exactly the label
the adapter gave it. (docs/DECISIONS.md D18.)

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

`evaluate({tool, args, control, config, catalog})` in `src/core/policy/engine.js`
is a pure function: labels in, `allow | ask | deny` out, with the rule that fired.

### Argument roles

Each tool argument has a role (`src/core/tools/specs.js`), and the rules are
written in terms of roles, not individual tools.

| Role          | Meaning               | Examples                                                   |
| ------------- | --------------------- | ---------------------------------------------------------- |
| `destination` | where data goes       | `send_email.to`, `fetch_url.url`                           |
| `selector`    | which thing to act on | `read_file.path`, `read_email.from`, `lookup_contact.name` |
| `data`        | content being moved   | `send_email.body`                                          |
| `plain`       | anything else         | `send_email.subject`                                       |

### Two layers; the stricter answer wins (deny > ask > allow)

**Floor** (always applies; cannot be switched off from the Rules tab):

| Rule id                              | Decision | When                                                                         |
| ------------------------------------ | -------- | ---------------------------------------------------------------------------- |
| `unknown_tool`                       | deny     | the tool is not in the catalog                                               |
| `invalid_arguments`                  | deny     | arguments do not match the tool, or are not tracked values                   |
| `tool_disabled`                      | deny     | the tool is turned off                                                       |
| `no_rule_configured`                 | ask      | the tool is known but has no entry in the configuration                      |
| `untrusted_selector`                 | ask      | an untrusted value chooses what to read, look up or delete                   |
| `untrusted_destination`              | ask      | an untrusted value chooses the destination, and nothing private is sent      |
| `untrusted_destination_private_data` | **deny** | an untrusted value chooses the destination and private data would go with it |
| `untrusted_control_flow`             | ask      | the call is inside an `if`/`for_each` that depends on an untrusted value     |

A destination counts as **trusted** if its label is trusted, or its text exactly
matches an address in the user's trusted-destinations list (normalised to lower
case). **Private data** means anything in the outgoing content whose readers are
not `public`; for a send, that is every argument except the destination, and for
every tool it includes the destination itself, since a URL can carry data in its
text.

**Template** (the per-tool choice on the Rules tab):

| Template              | Effect                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `allow`               | adds nothing; only the floor applies                                                                             |
| `ask`                 | always ask (`template_ask`)                                                                                      |
| `deny`                | always deny (`template_deny`)                                                                                    |
| `trusted_destination` | ask (`recipient_not_permitted_private_data`) if the destination is trusted but may not receive this private data |

Defaults: tools with a destination argument use `trusted_destination`;
destructive tools use `ask`; everything else uses `allow`.

### May this destination receive this private data?

Yes if the user **named** it, or if it is among the readers of every private
value being sent. A destination is _named by the user_ when it was created as a
literal from the request (`user_request`), typed in an approval (`user_approval`),
or read from a tool that represents the user's own contacts. This is decided from
how the value was created, not from its label: a trusted address that merely
came from a trusted file is not "named", and neither is one assembled by joining
text. That is why "send once to the address in this file" still asks when the
data is private.

### The matrix (checked by an independent oracle in the tests)

| Destination                               | Data     | Decision |
| ----------------------------------------- | -------- | -------- |
| named by the user (typed or contact)      | anything | allow    |
| trusted, not named, among the readers     | private  | allow    |
| trusted, not named, not among the readers | private  | **ask**  |
| trusted                                   | public   | allow    |
| untrusted                                 | public   | **ask**  |
| untrusted                                 | private  | **deny** |

then raised to at least **ask** if the call is under an untrusted condition, and
to the template's answer if that is stricter.

### Explanations

Every decision carries an explanation built from fixed templates (never from a
model): a headline (`Blocked: Send email to “kim@promo-offers.example”`), the
reasons (which value, where it came from), the rule in words, and what the user
can do next. Previews are at most 80 characters and cover only the arguments
that triggered a rule, never message bodies.

### From ask to execution

`createPolicyGate` is the `authorize` function the interpreter calls.

- **allow** → mint a single-use authorization token and execute.
- **deny** → refuse. Nothing is asked; a human cannot override a deny.
- **ask** → the run pauses on an approval. Answers: `approve_once`,
  `approve_and_trust` (remembers the destination, then executes),
  `edit_destination` (the typed value becomes a user-chosen value, the whole call
  is judged again; a deny still blocks it; allow or ask proceeds because the user
  has just reviewed it), `reject`, `cancel`. Any other answer is a refusal.

The tool invoker (`createToolInvoker`) refuses to run any adapter without a token
that was minted for exactly that tool and those exact argument values, and each
token works once. Adapters are held inside the invoker and receive plain data.
