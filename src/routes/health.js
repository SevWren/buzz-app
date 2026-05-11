import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
  // Prevent proxies and browsers from caching health-check responses —
  // stale "ok" replies can mask an outage.
  res.set('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

export default router;
