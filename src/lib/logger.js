import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.logLevel,

  // Redact common sensitive field names wherever they appear in log objects.
  // This prevents accidental logging of secrets if error objects or records
  // ever contain credential-like fields (e.g. from a future middleware).
  redact: {
    paths: ['password', 'token', 'secret', 'authorization', 'cookie',
            '*.password', '*.token', '*.secret', '*.authorization', '*.cookie'],
    censor: '[REDACTED]',
  },

  // Serialise Error objects to include only message and code — never the full
  // stack trace in log output (stack traces expose local file-system paths).
  serializers: {
    err:     pino.stdSerializers.errWithCause,
    safeErr: pino.stdSerializers.errWithCause,
  },

  ...(config.nodeEnv === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  }),
});
