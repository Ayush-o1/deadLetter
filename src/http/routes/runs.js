// Runs: create (plan), execute, cancel, read, search, and the flow graph.
import { Router } from 'express';
import { z } from 'zod';
import { stepRoots, subgraph, usedBy } from '../../runtime/graph.js';
import { AppError } from '../errors.js';
import { parse } from '../validate.js';

const createBody = z.strictObject({ request: z.string().trim().min(1).max(2000) });
const idParam = z.string().min(1).max(100);
const listQuery = z.strictObject({
  q: z.string().max(200).optional(),
  status: z
    .enum([
      'planning',
      'planned',
      'running',
      'awaiting_approval',
      'completed',
      'blocked',
      'failed',
      'cancelled',
      'interrupted',
    ])
    .optional(),
  decision: z.enum(['allow', 'ask', 'deny']).optional(),
  ruleId: z.string().max(80).optional(),
  tool: z.string().max(40).optional(),
  decidedBy: z.enum(['engine', 'user']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const graphQuery = z.strictObject({ step: z.coerce.number().int().min(0).optional() });

/** @param {ReturnType<import('../../composition.js').createServices>} services */
export function runsRouter({ runs }) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { request } = parse(createBody, req.body);
    res.status(201).json(await runs.create(request));
  });

  router.get('/', async (req, res) => {
    res.json({ runs: await runs.list(parse(listQuery, req.query)) });
  });

  router.get('/:id', async (req, res) => {
    res.json(await runs.get(parse(idParam, req.params.id)));
  });

  router.post('/:id/execute', async (req, res) => {
    res.status(202).json(await runs.execute(parse(idParam, req.params.id)));
  });

  router.post('/:id/cancel', async (req, res) => {
    res.json(await runs.cancel(parse(idParam, req.params.id)));
  });

  // The provenance graph of a run, or of one step's values, for the flow explorer.
  router.get('/:id/graph', async (req, res) => {
    const run = await runs.get(parse(idParam, req.params.id));
    const { step: seq } = parse(graphQuery, req.query);
    const nodes = run.provenance?.nodes ?? [];
    let selected = nodes;
    if (seq !== undefined) {
      const step = run.steps.find((s) => s.seq === seq);
      if (!step) throw new AppError(404, 'not_found', 'No such step');
      selected = subgraph(nodes, stepRoots(step));
    }
    res.json({ nodes: selected, usedBy: usedBy(run.steps) });
  });

  return router;
}
