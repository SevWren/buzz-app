import 'dotenv/config';
import { z } from 'zod';

// Validate every env var at process startup.
// If anything is wrong the server refuses to start with a clear error message
// rather than silently misonfiguring itself (e.g. PORT='abc' falling back to 3000).
export const envSchema = z.object({
  PORT: z.coerce
    .number({ invalid_type_error: 'PORT must be a number' })
    .int('PORT must be an integer')
    .min(1, 'PORT must be >= 1')
    .max(65535, 'PORT must be <= 65535')
    .default(3000),

  NODE_ENV: z
    .enum(['development', 'test', 'production'], {
      errorMap: () => ({ message: 'NODE_ENV must be development | test | production' }),
    })
    .default('development'),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'], {
      errorMap: () => ({
        message: 'LOG_LEVEL must be fatal | error | warn | info | debug | trace | silent',
      }),
    })
    .default('info'),

  CORS_ORIGIN: z
    .string()
    .min(1, 'CORS_ORIGIN cannot be empty')
    // Must be the wildcard '*' or a valid http/https origin (no trailing slash).
    // Rejects obviously malformed values like bare strings, path-only values, etc.
    .refine(
      (v) => v === '*' || /^https?:\/\/[^/]+$/.test(v),
      'CORS_ORIGIN must be "*" or a valid origin (e.g. http://192.168.1.50:3000)',
    )
    .default('*'),

  MAX_SOCKET_CONNECTIONS: z.coerce
    .number({ invalid_type_error: 'MAX_SOCKET_CONNECTIONS must be a number' })
    .int('MAX_SOCKET_CONNECTIONS must be an integer')
    .min(1,    'MAX_SOCKET_CONNECTIONS must be >= 1')
    .max(1000, 'MAX_SOCKET_CONNECTIONS must be <= 1000')
    .default(50),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  // Logger is not available yet — use console directly.
  console.error('[config] Invalid environment variables:');
  for (const [key, messages] of Object.entries(result.error.flatten().fieldErrors)) {
    console.error(`  ${key}: ${messages.join(', ')}`);
  }
  process.exit(1);
}

const env = result.data;

export const config = {
  port:                env.PORT,
  nodeEnv:             env.NODE_ENV,
  logLevel:            env.LOG_LEVEL,
  maxSocketConnections: env.MAX_SOCKET_CONNECTIONS,
  cors: {
    origin: env.CORS_ORIGIN,
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
  },
};
