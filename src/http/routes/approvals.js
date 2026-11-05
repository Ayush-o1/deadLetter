// Pending approvals: list them, answer them. The answer is checked by the
// approval manager (known id, offered action) and acted on by the policy gate.
import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../validate.js';

const answer = z.strictObject({
  action: z.enum(['approve_once', 'approve_and_trust', 'edit_destination', 'reject']),
  destination: z.string().trim().min(1).max(500).optional(),
});

export function approvalsRouter({ runs, approvals }) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ approvals: approvals.list() });
  });

  router.post('/:id/resolve', async (req, res) => {
    const body = parse(answer, req.body);
    await runs.resolveApproval(parse(z.string().uuid(), req.params.id), body);
    res.json({ ok: true });
  });

  return router;
}
