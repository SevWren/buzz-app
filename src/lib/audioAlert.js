import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { logger }        from './logger.js';
import playSound         from 'play-sound';

// play-sound is CJS but Node.js ESM interop can import it directly
const player = playSound({});

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ASSETS_DIR = join(__dirname, '..', '..', 'assets');

// Exact MP3 mapping — no random selection
const AUDIO_MAP = {
  'buzz':               'buzz_chat_1.mp3',
  'message':            'buzz_chat_1.mp3',
  'quick-need:Pickup':  'buzz_chat_2.mp3',
  'quick-need:Food':    'buzz_chat_2.mp3',
  'quick-need:Money':   'buzz_chat_3.mp3',
  'quick-need:Call Me': 'buzz_chat_4.mp3',
  'quick-need:Help':    'buzz_chat_5.mp3',
  'status':             'buzz_chat_6.mp3',
  'location':           'buzz_chat_3.mp3',
  'battery-low':        'buzz_chat_5.mp3',
  'countdown':          'buzz_chat_6.mp3',
  // 'reply' intentionally omitted — Dad is at the keyboard, no alert needed
};

/**
 * Play the MP3 alert mapped to the given event type.
 * Errors (no player installed, file not found) are caught and logged — never thrown.
 *
 * @param {string} type     - event type, e.g. 'buzz', 'quick-need', 'status'
 * @param {string} [subtype] - only used for 'quick-need' to select per-need file
 * @returns {void}
 */
export function playAlert(type, subtype) {
  const key  = subtype ? `${type}:${subtype}` : type;
  const file = AUDIO_MAP[key] ?? AUDIO_MAP[type];
  if (!file) return; // 'reply' and unknown types — silent

  const filePath = join(ASSETS_DIR, file);
  player.sound(filePath, (err) => {
    if (err) {
      logger.warn(
        { err, type, file },
        'audioAlert: playback failed — install afplay (macOS), aplay/mpg123 (Linux), or mplayer (Windows)',
      );
    }
  });
}
