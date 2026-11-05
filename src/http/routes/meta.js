import { Router } from 'express';
import { MOCK_SUPPORTED_REQUESTS } from '../../core/models/providers/mock.js';

/** What this installation can do: which model provider is in use and which requests it understands. */
export function metaRouter({ meta }) {
  const router = Router();
  router.get('/', (_req, res) => {
    res.json({
      modelProvider: meta.modelProvider,
      // The demo planner only recognises these shapes; a live model can plan others.
      supportedRequests: meta.modelProvider === 'mock' ? MOCK_SUPPORTED_REQUESTS : [],
    });
  });
  return router;
}
