import { config } from './config/index.js';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import healthRouter from './routes/health.js';
import { registerSocketHandlers, broadcastShutdown } from './handlers/socket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Express & HTTP ---
const app = express();
const httpServer = createServer(app);

// --- Socket.IO ---
const io = new Server(httpServer, {
  cors: { origin: config.cors.origin },
  connectionStateRecovery: {
    // Cap how long the server buffers events for a disconnected client.
    // Default is 2 minutes which can consume significant memory under connection churn.
    maxDisconnectionDuration: 30_000, // 30 seconds
    skipMiddlewares: true,
  },
});

// --- Middleware ---
// If running behind a reverse proxy (nginx, Caddy, etc.) uncomment the line
// below so express-rate-limit sees the real client IP instead of the proxy IP.
// app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false })); // tighten CSP in production
app.use(cors({ origin: config.cors.origin }));
app.use(express.json({ limit: '10kb' }));
app.use(
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// --- Static & routes ---
app.use(express.static(join(__dirname, '..', 'public')));
app.use('/api', healthRouter);

// --- Socket handlers ---
registerSocketHandlers(io);

// --- Error handler (must be last middleware) ---
app.use(errorHandler);

// --- Graceful shutdown ---
function shutdown(signal) {
  logger.info({ signal }, 'Shutdown signal received, closing server...');

  // Step 1: Warn all connected clients before tearing down anything.
  // broadcastShutdown must fire before disconnectSockets — once sockets are
  // closed the emit packet never reaches clients.
  broadcastShutdown(io);

  // Step 2: Wait ~300 ms so the broadcast packet has time to reach clients
  // over a LAN Wi-Fi link before the transport is torn down.
  setTimeout(() => {
    // Step 3: Close all WebSocket connections.
    // Without this, httpServer.close() waits for keep-alive connections to
    // drain which, for WebSockets, means waiting forever.
    io.disconnectSockets(true);

    httpServer.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  }, 300);

  // Force-kill if graceful close stalls
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled promise rejection');
  process.exit(1);
});

// --- Start ---
httpServer.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'Server started');
});
