# User guide

deadLetter lets an AI agent read untrusted text (emails, web pages, files) without
that text being able to choose which tool runs or where your private data goes.
This guide walks through the four screens: Run, Rules, History and Lab. Everything here uses **fake tools and demo
models**: no real email is sent and nothing leaves your machine.

Start the app (`npm start`) and open <http://127.0.0.1:3000>.

## Run

![The Run screen after a task has finished](screenshots/run-finished.png)

The screen follows the life of one task, left to right.

**Left: your task and its plan.** Describe what you want in plain words, then press
**Make a plan**. The plan appears as a short list of steps before anything runs:
this is the spec's "program" written by the planner. The planner sees only your words,
never an email, file or web page, so text inside them cannot change the plan. You
can **Run plan** or **Discard**. In demo mode the planner understands ten request
shapes (open "Try an example task"); a request outside them is reported as "No plan
was made" rather than guessed. A live model can plan any task.

**Middle: what is happening.** Each step shows its state (waiting, running, done,
needs approval, blocked, failed, not run) and what it used:

- **Value chips** say what the data is. They always mean the same thing:
  **Trusted** (green): no untrusted text had a hand in making it. **Untrusted**
  (orange): text from outside, or something made from it. **Private · only you**
  (slate): who may receive it. The small grey chips say where it came from (an
  email, a file, a web page, your contacts, your request, the quarantined model).
- **The decision strip** under a step that uses a tool shows **Allow**, **Ask** or
  **Deny**, and whether the rules or you decided.
- **Why?** opens the explanation: which value triggered which rule, where that value
  came from, the rule in words, and what you can do next. These sentences are fixed
  templates filled with the real values; no model writes them.
- **Trace** opens the information-flow explorer (below).

At the bottom, the **result** is shown as plain text (links and markup in it are
inert), and a banner says how the task ended. A blocked task says that the blocked
step did not run and the steps after it were skipped.

**Right: your decisions.** When the rules cannot be sure an action is safe, the run
**pauses** and a card appears here. It shows the exact action, each argument with
where it came from, a short warning when untrusted text influenced a value, and the
reason you are being asked.

![An approval card](screenshots/run-approval.png)

| Button                   | Does                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| Send once                | runs this one action                                                    |
| Send and trust _address_ | runs it and remembers the destination (see Rules)                       |
| Edit destination         | type a different destination; the whole action is checked again with it |
| Reject                   | the action never reaches the tool and the run stops                     |

Nothing proceeds until you choose. **Deny** decisions are never put to you: a
denied action is refused, with the reason on the step.

### The information-flow explorer

![The information-flow explorer](screenshots/flow-explorer.png)

Click **Trace** on a step to see where each value it used came from. Read it left to
right: sources (your request, a contact, a file), then the changes made on the way
(the quarantined model summarising, text being joined), then what reached the tool,
tagged with the argument it became (`→ body`). Box colour is the trust label, and a
dashed line means a value exists only because of an earlier condition. Click a box for
its label in words. This is how you check the system's reasoning yourself.

## Rules

![The Rules screen](screenshots/rules.png)

Each tool can be on or off and has one rule:

| Rule                        | Meaning                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| Allow                       | runs without asking (the always-on rules still apply)                                                 |
| Always ask                  | pauses every time                                                                                     |
| Always deny                 | never runs                                                                                            |
| Destination must be trusted | runs if the destination is one you named or trust; asks if private data would go somewhere it may not |

The **Always on** panel lists what cannot be turned off here: untrusted text cannot
choose a destination or what to read or delete, a condition that depends on untrusted
text cannot act silently, an unknown tool is denied, and a tool with no rule asks.
Your choice can only make a tool stricter than these.

**Trusted destinations** are addresses you chose to trust. They skip the question when
outside text suggested them. Private data still asks unless you named the recipient in
your request. "Send and trust" on an approval card adds to this list.

## History

![History](screenshots/history.png)

Every task is recorded. Search by what you asked, or filter by status, by what the
rules decided on some step (Allowed, Asked, Denied), by who decided, and by tool.
Open a task to see its steps, decisions and reasons, its result, and a timeline. The
record keeps **labels, sources and short previews**, never whole private documents:
the log would otherwise be a second place to leak from. A task that was running when
the server restarted is shown as **Interrupted**.

## Lab

The Lab is where you test the idea instead of taking it on trust. Everything in it runs
on the fake tools, with the same task and the same world for every defence.

### Scenarios

![A scenario against every defence, with the clean-versus-attacked diff](screenshots/lab-scenario.png)

Pick one of the 20 prepared scenarios (11 attacks, 9 normal tasks). You see the task and,
for an attack, the exact text the attacker placed and where. **Run against all defences**
shows four cards: no defence, a simple session-taint rule, deadLetter, and deadLetter if
you approved every prompt. Each card says what happened and lists the actions that
actually ran, were blocked, or were put to you. Normal tasks matter as much as attacks:
a defence that blocks everything is not a product.

**Clean versus attacked** runs the task twice, once with the attacker's text in place and
once without, and lists any action that only the attack caused. For an unprotected agent
it shows the extra send. For deadLetter the plan is made once from your request, so it
shows "Identical actions". Text derived from the content, such as a summary, can differ
and is not compared.

### Your own attack

Choose a task, where the text goes, what an obedient agent should then try to do, and
write the text. The menus are fixed presets and your text is only ever shown as text.
Some attempts get through, such as a misleading summary sent to a recipient you allowed,
and the Lab shows that honestly.

### Evaluation

![The evaluation dashboard](screenshots/lab-evaluation.png)

**Run the full evaluation** runs every scenario against every defence and stores the
report. The two charts show the attack success rate (lower is better) and the share of
normal tasks completed (higher is better), with the count behind every percentage. Below
them are the attacks that succeeded, the normal tasks that did not complete and why, and
a row for every scenario. Export the report as Markdown or JSON. The limits are stated at
the top: mock models, a worst-case attacker, this scenario set only, not a proof. The
method and every figure are explained in [EVALUATION.md](EVALUATION.md).

## What the app does not do

It is a research prototype with fake tools. It does not stop a misleading summary
being sent to a recipient you allowed, a mistaken approval, wrong labels or wrong
rules. See [THREAT_MODEL.md](THREAT_MODEL.md).
