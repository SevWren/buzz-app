import { logger } from '../lib/logger.js';

/**
 * Express middleware — allows only localhost requests through.
 * Checks req.ip (set by Express from socket.remoteAddress).
 * Strips IPv4-mapped prefix ::ffff: before comparison.
 *
 * @param {import('express').Request}      req
 * @param {import('express').Response}     res
 * @param {import('express').NextFunction} next
 */
export function adminGuard(req, res, next) {
  const raw        = req.ip ?? req.socket?.remoteAddress ?? '';
  const normalized = raw.replace('::ffff:', '');
  const isLocal    =
    normalized === '127.0.0.1' ||
    normalized === '::1'       ||
    normalized === 'localhost';

  if (!isLocal) {
    logger.warn({ ip: raw }, 'Admin access denied from non-localhost IP');
    res.status(403).json({ error: 'Admin access is restricted to localhost only.' });
    return;
  }
  next();
}
