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
import adminRouter from './routes/admin.js';
import { registerSocketHandlers, broadcastShutdown } from './handlers/socket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Express & HTTP ---
const app = express();
const httpServer = createServer(app);

// --- Socket.IO ---
// Security notes:
//   - connectionStateRecovery is intentionally omitted: it has skipMiddlewares:true
//     which bypasses the isAdmin auth middleware on reconnect.
//   - maxHttpBufferSize limits per-message size to 16 KB (default 1 MB) to prevent
//     memory exhaustion from large payloads.
//   - transports: ['websocket'] disables HTTP long-polling, reducing attack surface.
//   - cookie: false explicitly disables Socket.IO session cookies (unused by this app).
const io = new Server(httpServer, {
  cors: {
    origin:         config.cors.origin,
    methods:        ['GET', 'POST'],   // only methods actually used
    exposedHeaders: [],                // expose no extra response headers to JS
  },
  maxHttpBufferSize: 16 * 1024,  // 16 KB max message — well above any valid payload
  transports:        ['websocket'],
  cookie:            false,
  upgradeTimeout:    10_000,     // abort stalled HTTP→WS upgrade after 10 s
});

// Reject new connections when the server is already at capacity.
// Without this, a single IP can open many sockets and bypass per-socket rate limits.
const MAX_SOCKET_CONNECTIONS = 50;
io.use((socket, next) => {
  if (io.engine.clientsCount > MAX_SOCKET_CONNECTIONS) {
    logger.warn(
      { address: socket.handshake.address, count: io.engine.clientsCount },
      'Socket connection limit exceeded — rejecting new connection',
    );
    return next(new Error('Connection limit exceeded'));
  }
  next();
});

// Log Engine.IO-level connection errors for security monitoring.
io.engine.on('connection_error', (err) => {
  logger.warn({ code: err.code, message: err.message }, 'Socket.IO connection error');
});

// --- Middleware ---
// SECURITY NOTE: trust proxy is intentionally disabled. Enabling it without a
// real proxy in front will let clients spoof X-Forwarded-For, bypassing rate
// limits and skewing adminGuard IP checks. Only uncomment when running behind
// a trusted reverse proxy (nginx, Caddy, etc.).
// app.set('trust proxy', 1);

// Content-Security-Policy: scoped to what this app actually serves.
//   - script-src 'self'   — all JS loaded from same origin (incl. /socket.io/socket.io.js)
//   - style-src 'unsafe-inline' — <style> blocks exist in index.html and admin.html
//   - connect-src ws: wss: — Socket.IO WebSocket connections
//   - frame-ancestors 'none' — prevent clickjacking
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],
      styleSrc:       ["'self'", "'unsafe-inline'"],
      connectSrc:     ["'self'", 'ws:', 'wss:'],
      fontSrc:        ["'self'", 'data:'],
      imgSrc:         ["'self'", 'data:'],
      objectSrc:      ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
      frameAncestors: ["'none'"],
      workerSrc:      ["'none'"],
    },
  },
  referrerPolicy:           { policy: 'no-referrer' },
  crossOriginOpenerPolicy:  { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
}));

// Permissions-Policy: disable browser features the app doesn't use.
app.use((_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  );
  next();
});

app.use(cors({
  origin:         config.cors.origin,
  methods:        ['GET', 'POST', 'OPTIONS'],
  exposedHeaders: [],
}));
app.use(express.json({ limit: '10kb', strict: true })); // strict: reject bare values, only accept {} and []
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
app.use('/admin', adminRouter);

// --- Socket admin-auth middleware ---
// Mark connections from localhost as admin sockets.
// socket.data.isAdmin is checked in send-reply and admin-mark-read handlers.
io.use((socket, next) => {
  const raw        = socket.handshake.address ?? '';
  const normalized = raw.replace('::ffff:', '').toLowerCase();
  socket.data.isAdmin =
    normalized === '127.0.0.1' ||
    normalized === '::1'       ||
    normalized === 'localhost';

  if (!socket.data.isAdmin) {
    logger.info(
      { address: raw },
      'Socket connection from non-localhost (isAdmin=false)',
    );
  }
  next();
});

// --- Socket handlers ---
registerSocketHandlers(io);

// --- Error handler (must be last middleware) ---
app.use(errorHandler);

// --- Graceful shutdown ---
let isShuttingDown = false;

function shutdown(signal) {
  if (isShuttingDown) return; // guard against double SIGTERM / SIGINT
  isShuttingDown = true;
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
