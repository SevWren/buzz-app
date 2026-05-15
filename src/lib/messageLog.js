import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, join }               from 'node:path';
import { fileURLToPath }               from 'node:url';
import { randomUUID }                  from 'node:crypto';
import { logger }                      from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const LOG_PATH   = join(__dirname, '..', '..', 'data', 'messages.jsonl');
const DATA_DIR   = join(__dirname, '..', '..', 'data');

/**
 * Append a message record to data/messages.jsonl.
 * Creates the data/ directory if it does not exist.
 * Never throws — a log failure must not crash the server.
 *
 * @param {{ direction: 'in'|'out', type: string, socketId: string, payload: object }} record
 * @returns {Promise<void>}
 */
export async function appendMessage(record) {
  // Validate and coerce all fields to their expected types before persisting.
  // socket.js always passes correct types, but defensive coercion prevents
  // accidental non-string values from corrupting the JSONL log or bypassing
  // any downstream parsing that depends on field types.
  if (!record || typeof record !== 'object') return;

  const direction = typeof record.direction === 'string' ? record.direction : '';
  const type      = typeof record.type      === 'string' ? record.type      : '';
  const socketId  = typeof record.socketId  === 'string' ? record.socketId  : '';
  const payload   =
    record.payload !== null && typeof record.payload === 'object'
      ? record.payload
      : {};

  const line =
    JSON.stringify({
      id:        randomUUID(),
      ts:        new Date().toISOString(),
      direction,
      type,
      socketId,
      payload,
    }) + '\n';
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(LOG_PATH, line, 'utf8');
  } catch (err) {
    logger.error({ err }, 'messageLog: append failed');
  }
}

/**
 * Return the most recent `limit` records from the log, oldest-first.
 * Returns [] if the file does not exist or any error occurs.
 *
 * @param {number} [limit=100]
 * @returns {Promise<object[]>}
 */
export async function readRecentMessages(limit = 100) {
  try {
    const raw    = await readFile(LOG_PATH, 'utf8');
    const lines  = raw.split('\n').filter(l => l.trim() !== '');
    const recent = lines.slice(-limit);
    const parsed = [];
    for (const line of recent) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }
    return parsed; // oldest-first (file is append-order)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn({ err }, 'messageLog: read failed');
    }
    return [];
  }
}
