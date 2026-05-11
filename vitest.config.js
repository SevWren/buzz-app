import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    // Default 5 s is tight for socket integration tests that open real TCP
    // connections.  10 s keeps CI fast while absorbing transient I/O delays.
    testTimeout: 10_000,
    // Set env vars before any module is loaded so logger/config pick up test values
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.js'],
      // server.js is a bootstrap entry point — covered by integration tests,
      // but excluded from thresholds since it can't be unit-tested in isolation
      exclude: ['src/server.js'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
