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
  // no-store: prevent the browser or proxy caching the admin panel;
  // a cached version could expose the UI after the session ends.
  res.set('Cache-Control', 'no-store');
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
    // no-store: message history is sensitive — must not be cached by
    // browsers or proxies where other users could read it.
    res.set('Cache-Control', 'no-store');
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

export default router;
