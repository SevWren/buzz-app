import { Router }             from 'express';
import { join, dirname }      from 'node:path';
import { fileURLToPath }      from 'node:url';
import { adminGuard }         from '../middleware/adminGuard.js';
import { readRecentMessages } from '../lib/messageLog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const router = Router();

// Every route under /admin requires localhost
router.use(adminGuard);

/**
 * GET /admin
 * Serves the admin HTML page.
 */
router.get('/', (_req, res) => {
  res.sendFile(join(__dirname, '..', '..', 'public', 'admin.html'));
});

/**
 * GET /admin/history
 * Returns the last 100 log entries as JSON.
 * Used by admin.js on page load to populate the conversation thread.
 */
router.get('/history', async (_req, res, next) => {
  try {
    const messages = await readRecentMessages(100);
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

export default router;
