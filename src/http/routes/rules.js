// Rules: which tools are on, each tool's template, and trusted destinations.
// Changes apply to the NEXT policy decision; a run in progress reads the current
// configuration at each tool call.
import { Router } from 'express';
import { z } from 'zod';
import { TEMPLATES } from '../../core/policy/config.js';
import { AppError } from '../errors.js';
import { parse } from '../validate.js';

const toolSetting = z.strictObject({
  enabled: z.boolean(),
  template: z.enum(Object.keys(TEMPLATES)),
});
const toolName = z.string().regex(/^[a-z][a-z0-9_]{0,30}$/);
const destination = z.strictObject({ destination: z.string().trim().min(3).max(500) });

export function rulesRouter({ policy }) {
  const router = Router();

  router.get('/', async (_req, res) => {
    res.json({
      tools: await policy.listTools(),
      templates: TEMPLATES,
      trustedDestinations: await policy.listTrusted(),
    });
  });

  router.put('/tools/:name', async (req, res) => {
    const name = parse(toolName, req.params.name);
    const ok = await policy.setTool(name, parse(toolSetting, req.body));
    if (!ok) throw new AppError(404, 'not_found', 'No such tool');
    res.json({ ok: true });
  });

  router.post('/trusted', async (req, res) => {
    const { destination: value } = parse(destination, req.body);
    res.status(201).json({ destination: await policy.addTrusted(value) });
  });

  router.delete('/trusted', async (req, res) => {
    const { destination: value } = parse(destination, req.body);
    if (!(await policy.removeTrusted(value)))
      throw new AppError(404, 'not_found', 'That destination is not trusted');
    res.json({ ok: true });
  });

  return router;
}
