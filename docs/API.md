# HTTP API

JSON over HTTP on `http://127.0.0.1:3000` (loopback only by default). Errors are
always `{"error": {"code", "message", "details"?}}` with a fitting status; stack
traces never leave the server. All input is validated with strict schemas
(unknown keys are rejected). There are no accounts, so there is nothing to
authenticate: do not expose this server to a network.

Every security rule is enforced in the backend; the UI is only a client of this API.

Requests are accepted only for loopback `Host` names (plus any in `ALLOWED_HOSTS`) and
only without an `Origin`, or with this server's own. Anything else is `403`
(`forbidden_host`, `forbidden_origin`). This stops a web page in your browser from using
the API; it is not authentication.

## Runs

| Method and path                    | Does                                                                                                                                                                                                             | Success |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `POST /api/runs` `{request}`       | Plan the request. **Nothing runs.** Returns the run with `plan` and `planPreview` (or `status: "failed"` with `error.code` `cannot_plan` / `invalid_plan` / `planner_failed`).                                   | 201     |
| `POST /api/runs/:id/execute`       | Start a planned run in the background.                                                                                                                                                                           | 202     |
| `GET /api/runs/:id`                | Snapshot: `status`, `steps`, `pendingApprovals` (with cards), `results`, `events`, `error`. Poll this while a run is active.                                                                                     | 200     |
| `POST /api/runs/:id/cancel`        | No new step starts; pending approvals are dropped.                                                                                                                                                               | 200     |
| `GET /api/runs`                    | History. Filters: `q` (text in the request), `status`, `decision` (`allow`/`ask`/`deny`), `ruleId`, `tool`, `decidedBy` (`engine`/`user`), `limit` (max 200), `offset`. Step filters must hold on the same step. | 200     |
| `GET /api/runs/:id/graph[?step=N]` | Provenance graph (labels, origins, short previews, edges; never full text), optionally just the values behind step `N`, plus `usedBy` (where each value was used as a tool argument).                            | 200     |

Run statuses: `planning`, `planned`, `running`, `awaiting_approval`, `completed`,
`blocked` (denied or rejected), `failed`, `cancelled`, `interrupted` (the server
restarted mid-run). Starting a run that is not `planned`, or cancelling a finished
one, is `409`; an unknown id is `404`.

```bash
curl -s -X POST localhost:3000/api/runs -H 'content-type: application/json' \
  -d '{"request":"Read Bob'"'"'s latest email, summarise it, and send the summary to Alice."}'
curl -s -X POST localhost:3000/api/runs/$ID/execute
curl -s localhost:3000/api/runs/$ID
```

## Approvals

| Method and path                                            | Does                                                                                                                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/approvals`                                       | Pending approvals with their cards (action, arguments with origin, warnings, explanation, available actions).                                                                                                                      |
| `POST /api/approvals/:id/resolve` `{action, destination?}` | `action` is `approve_once`, `approve_and_trust`, `edit_destination` (needs `destination`) or `reject`. Answering twice, or an unknown id, is `404`. A choice the card did not offer is `409`. A **deny** is never put to the user. |

## Rules

| Method and path                                    | Does                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /api/rules`                                   | Tools (with `configured`, `enabled`, `template`), the templates and their descriptions, trusted destinations. |
| `PUT /api/rules/tools/:name` `{enabled, template}` | Template: `allow`, `ask`, `deny`, `trusted_destination`. Takes effect on the next policy decision.            |
| `POST /api/rules/trusted` `{destination}`          | Trust a destination (normalised to lower case).                                                               |
| `DELETE /api/rules/trusted` `{destination}`        | Stop trusting it.                                                                                             |

## Lab

| Method and path                                                           | Does                                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /api/lab/scenarios`                                                  | The 20 prepared scenarios and the choices for the custom playground.                             |
| `POST /api/lab/scenarios/:id/run`                                         | One scenario against every defence (deadLetter twice for attacks: user rejects / user approves). |
| `GET /api/lab/scenarios/:id/diff?defence=none\|session_taint\|deadletter` | Clean versus attacked: the two action lists and their difference.                                |
| `POST /api/lab/custom` `{request, where, text, goal}`                     | Your own attack, from preset choices only.                                                       |
| `POST /api/lab/evaluations`                                               | Run and store the full evaluation.                                                               |
| `GET /api/lab/evaluations`, `/:id`, `/:id/markdown`                       | Stored reports; the Markdown export.                                                             |

## Other

`GET /api/health` (database check, 503 when unreachable), `GET /api/meta` (model
provider; the requests the demo planner understands).
