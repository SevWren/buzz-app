import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSound = vi.fn();

vi.mock('play-sound', () => ({
  default: vi.fn(() => ({ sound: mockSound })),
}));
vi.mock('../../src/lib/logger.js', () => ({
  logger: { warn: vi.fn() },
}));

import { logger } from '../../src/lib/logger.js';

async function getPlayAlert() {
  vi.resetModules();
  const mod = await import('../../src/lib/audioAlert.js');
  return mod.playAlert;
}

describe('playAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls player.sound for type "buzz"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('buzz');
    expect(mockSound).toHaveBeenCalledTimes(1);
  });

  it('plays buzz_chat_1.mp3 for type "buzz"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('buzz');
    const [path] = mockSound.mock.calls[0];
    expect(path).toMatch(/buzz_chat_1\.mp3$/);
  });

  it('plays buzz_chat_1.mp3 for type "message"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('message');
    const [path] = mockSound.mock.calls[0];
    expect(path).toMatch(/buzz_chat_1\.mp3$/);
  });

  it('plays buzz_chat_2.mp3 for quick-need "Pickup"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('quick-need', 'Pickup');
    const [path] = mockSound.mock.calls[0];
    expect(path).toMatch(/buzz_chat_2\.mp3$/);
  });

  it('plays buzz_chat_2.mp3 for quick-need "Food"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('quick-need', 'Food');
    const [path] = mockSound.mock.calls[0];
    expect(path).toMatch(/buzz_chat_2\.mp3$/);
  });

  it('plays buzz_chat_3.mp3 for quick-need "Money"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('quick-need', 'Money');
    const [path] = mockSound.mock.calls[0];
    expect(path).toMatch(/buzz_chat_3\.mp3$/);
  });

  it('plays buzz_chat_4.mp3 for quick-need "Call Me"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('quick-need', 'Call Me');
    const [path] = mockSound.mock.calls[0];
    expect(path).toMatch(/buzz_chat_4\.mp3$/);
  });

  it('plays buzz_chat_5.mp3 for quick-need "Help"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('quick-need', 'Help');
    const [path] = mockSound.mock.calls[0];
    expect(path).toMatch(/buzz_chat_5\.mp3$/);
  });

  it('plays buzz_chat_6.mp3 for type "status"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('status');
    const [path] = mockSound.mock.calls[0];
    expect(path).toMatch(/buzz_chat_6\.mp3$/);
  });

  it('plays buzz_chat_3.mp3 for type "location"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('location');
    const [path] = mockSound.mock.calls[0];
    expect(path).toMatch(/buzz_chat_3\.mp3$/);
  });

  it('plays buzz_chat_5.mp3 for type "battery-low"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('battery-low');
    const [path] = mockSound.mock.calls[0];
    expect(path).toMatch(/buzz_chat_5\.mp3$/);
  });

  it('plays buzz_chat_6.mp3 for type "countdown"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('countdown');
    const [path] = mockSound.mock.calls[0];
    expect(path).toMatch(/buzz_chat_6\.mp3$/);
  });

  it('does NOT call player.sound for type "reply"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('reply');
    expect(mockSound).not.toHaveBeenCalled();
  });

  it('does NOT call player.sound for unknown type', async () => {
    const playAlert = await getPlayAlert();
    playAlert('unknown-event');
    expect(mockSound).not.toHaveBeenCalled();
  });

  it('calls logger.warn when player.sound callback receives an error, does not throw', async () => {
    const playAlert = await getPlayAlert();
    // Simulate play-sound calling back with an error
    mockSound.mockImplementationOnce((_path, cb) => cb(new Error('no player')));
    expect(() => playAlert('buzz')).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.any(String),
    );
  });
});
