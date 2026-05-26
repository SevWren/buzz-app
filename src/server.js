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
    credentials:    false,             // never send cookies/credentials cross-origin
  },
  // 4 KB max message — the largest valid payload (send-message 500 chars) is ~560 bytes.
  // 16 KB (previous) was 26× larger than needed; 4 KB keeps generous headroom.
  maxHttpBufferSize: 4 * 1024,
  transports:        ['websocket'],
  cookie:            false,
  upgradeTimeout:    10_000,  // abort stalled HTTP→WS upgrade after 10 s
  pingTimeout:       5_000,   // 5 s to respond to ping before considering connection dead
  pingInterval:      25_000,  // send keepalive ping every 25 s
});

// Reject new connections when the server is already at capacity.
// Without this, a single IP can open many sockets and bypass per-socket rate limits.
io.use((socket, next) => {
  if (io.engine.clientsCount >= config.maxSocketConnections) { // BUG-04: >= not >
    logger.warn(
      { address: socket.handshake?.address, count: io.engine.clientsCount },
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
      // 'self' in connect-src covers WebSocket connections to the same origin
    // (confirmed in CSP Level 3 spec and all modern browsers), so explicit
    // ws:/wss: wildcards are not needed — they would allow connections to any host.
    connectSrc:     ["'self'"],
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
  credentials:    false,  // never reflect credentials (cookies/auth) in CORS responses
}));
app.use(express.json({ limit: '10kb', strict: true })); // strict: reject bare values, only accept {} and []
app.use(
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max:      config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders:   false,
    // Use the same JSON shape the rest of the app uses for errors, so clients
    // don't have to handle two different error response schemas.
    handler: (_req, res) => {
      res.status(429).json({ error: { message: 'Too many requests — please slow down.' } });
    },
  })
);

// --- Static & routes ---
// Explicit root handler: express.static({ index: false }) disables automatic index.html
// lookup for directory requests, so GET / would fall through to a 404 without this route.
// index: false is kept to prevent directory listing for /fonts/ and other subdirs.
app.get('/', (_req, res) => {
  res.sendFile(join(__dirname, '..', 'public', 'index.html'));
});
app.use(express.static(join(__dirname, '..', 'public'), {
  index:    false,            // don't serve directory index files (prevents listing /fonts/ etc.)
  dotfiles: 'ignore',         // never serve .env, .git, etc. if accidentally placed in public/
}));
app.use('/api', healthRouter);
app.use('/admin', adminRouter);

// --- Socket admin-auth middleware ---
// Mark connections from localhost as admin sockets and join them to the 'admin' room.
// socket.data.isAdmin is checked in send-reply and admin-mark-read handlers.
// The 'admin' room is used to scope incoming-message broadcasts (BUG-02 fix):
// non-admin sockets no longer receive events they did not themselves send.
io.use((socket, next) => {
  const raw        = socket.handshake.address ?? '';
  const normalized = raw.replace('::ffff:', '').toLowerCase();
  socket.data.isAdmin =
    normalized === '127.0.0.1' ||
    normalized === '::1'       ||
    normalized === 'localhost';

  if (socket.data.isAdmin) {
    socket.join('admin');
  } else {
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
