/**
 * Global test setup — runs before every test file.
 *
 * Sets env vars early so that config/index.js and logger.js pick up the
 * correct values when they are first imported in a test module.
 * vitest.config.js also sets these via `test.env`, but setting them here
 * as well ensures they survive vi.resetModules() calls in config tests.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
