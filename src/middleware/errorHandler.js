import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';

/**
 * Centralised Express error handler.
 * Express 5 automatically catches async errors, so any thrown error lands here.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  // Guard: normalise null/primitive errors to an Error object so that property
  // accesses below (err.status, err.message) never throw a secondary TypeError.
  // Express should always pass an Error, but some middleware may call next(null)
  // or next('string') — without this guard the handler itself would crash.
  const safeErr = (err !== null && typeof err === 'object')
    ? err
    : new Error(err == null ? 'Internal Server Error' : String(err));

  logger.error({ err: safeErr, path: req.path }, 'Unhandled request error');

  // Sanitize the status code: accept only valid 4xx/5xx integers.
  // An error object with a bogus .status (NaN, 999, -1, a string, …) must
  // fall back to 500 rather than producing a malformed HTTP response.
  const raw = safeErr.status ?? safeErr.statusCode;
  const status =
    Number.isInteger(raw) && raw >= 400 && raw <= 599
      ? raw
      : 500;

  // Never reveal internal error messages for 5xx responses in production.
  // 4xx errors are safe to forward — they describe a client mistake, not a
  // server implementation detail.
  const isServerError = status >= 500;
  const message =
    isServerError && config.nodeEnv === 'production'
      ? 'Internal Server Error'
      : safeErr.message || 'Internal Server Error';

  res.status(status).json({ error: { message } });
}
