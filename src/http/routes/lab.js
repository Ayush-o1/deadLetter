// Lab: run prepared scenarios and your own attacks against the three defences,
// diff a clean run against an attacked one, and run and store full evaluations.
import { Router } from 'express';
import { z } from 'zod';
import { MOCK_SUPPORTED_REQUESTS } from '../../core/models/providers/mock.js';
import { DEFENCES, runDefence } from '../../eval/defences.js';
import { GOAL_PRESETS, buildCustomScenario } from '../../eval/custom.js';
import { runCleanVsAttacked } from '../../eval/diff.js';
import { renderMarkdown } from '../../eval/report.js';
import { runEvaluation } from '../../eval/runner.js';
import { loadScenarios } from '../../eval/scenario.js';
import { AppError } from '../errors.js';
import { parse } from '../validate.js';

const idParam = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(80);
const diffQuery = z.strictObject({ defence: z.enum(DEFENCES) });
const reportId = z.string().uuid();

/** Run one scenario against every defence (deadLetter twice for attacks). */
async function runAll(scenario) {
  const runs = {};
  for (const defence of DEFENCES) {
    if (defence === 'deadletter' && scenario.kind === 'attack') {
      runs.deadletter = await runDefence(scenario, 'deadletter', { userApproval: 'reject' });
      runs.deadletter_user_approves = await runDefence(scenario, 'deadletter', {
        userApproval: 'approve',
      });
    } else {
      runs[defence] = await runDefence(scenario, defence);
    }
  }
  return runs;
}

const publicScenario = (s) => ({
  id: s.id,
  kind: s.kind,
  title: s.title,
  description: s.description,
  request: s.request,
  injection: s.injection
    ? { where: s.injection.target, position: s.injection.position, text: s.injection.text }
    : null,
  note: s.note ?? null,
});

export function labRouter({ evals }) {
  const router = Router();
  const scenarios = loadScenarios();
  const find = (id) => {
    const scenario = scenarios.find((s) => s.id === id);
    if (!scenario) throw new AppError(404, 'not_found', 'No such scenario');
    return scenario;
  };

  router.get('/scenarios', (_req, res) => {
    res.json({
      scenarios: scenarios.map(publicScenario),
      custom: {
        requests: MOCK_SUPPORTED_REQUESTS,
        places: ['email', 'page', 'contract', 'brief'],
        goals: Object.fromEntries(Object.entries(GOAL_PRESETS).map(([k, v]) => [k, v.label])),
      },
    });
  });

  router.post('/scenarios/:id/run', async (req, res) => {
    const scenario = find(parse(idParam, req.params.id));
    res.json({ scenario: publicScenario(scenario), runs: await runAll(scenario) });
  });

  router.get('/scenarios/:id/diff', async (req, res) => {
    const scenario = find(parse(idParam, req.params.id));
    if (scenario.kind !== 'attack')
      throw new AppError(400, 'not_an_attack', 'Only attack scenarios have an attacked version');
    const { defence } = parse(diffQuery, req.query);
    res.json(await runCleanVsAttacked(scenario, defence));
  });

  // The attack playground: preset choices only, no free-form requests or goals.
  router.post('/custom', async (req, res) => {
    const scenario = buildCustomScenario(parse(z.record(z.string(), z.unknown()), req.body));
    res.json({ scenario: publicScenario(scenario), runs: await runAll(scenario) });
  });

  router.post('/evaluations', async (_req, res) => {
    const report = await runEvaluation({ scenarios });
    const saved = await evals.save(report);
    res.status(201).json({ ...saved, report });
  });

  router.get('/evaluations', async (_req, res) => {
    res.json({ evaluations: await evals.list() });
  });

  router.get('/evaluations/:id', async (req, res) => {
    const found = await evals.get(parse(reportId, req.params.id));
    if (!found) throw new AppError(404, 'not_found', 'No such report');
    res.json(found);
  });

  router.get('/evaluations/:id/markdown', async (req, res) => {
    const found = await evals.get(parse(reportId, req.params.id));
    if (!found) throw new AppError(404, 'not_found', 'No such report');
    res.type('text/markdown; charset=utf-8').send(renderMarkdown(found.report));
  });

  return router;
}
