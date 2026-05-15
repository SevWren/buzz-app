import { describe, it, expect, vi, beforeAll } from 'vitest';
import express  from 'express';
import request  from 'supertest';

const mockReadRecentMessages = vi.fn().mockResolvedValue([]);

vi.mock('../../src/lib/messageLog.js', () => ({
  readRecentMessages: mockReadRecentMessages,
}));
// Bypass the localhost guard in unit tests — adminGuard is tested separately
vi.mock('../../src/middleware/adminGuard.js', () => ({
  adminGuard: (_req, _res, next) => next(),
}));

let app;

beforeAll(async () => {
  const { default: adminRouter } = await import('../../src/routes/admin.js');
  app = express();
  app.use(express.static('public'));
  app.use('/admin', adminRouter);
});

describe('GET /admin/', () => {
  it('responds with HTTP 200', async () => {
    const res = await request(app).get('/admin/');
    expect(res.status).toBe(200);
  });

  it('responds with content-type text/html', async () => {
    const res = await request(app).get('/admin/');
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });
});

describe('GET /admin/history', () => {
  it('responds with HTTP 200', async () => {
    const res = await request(app).get('/admin/history');
    expect(res.status).toBe(200);
  });

  it('responds with content-type application/json', async () => {
    const res = await request(app).get('/admin/history');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('returns { messages: [] } when log is empty', async () => {
    mockReadRecentMessages.mockResolvedValueOnce([]);
    const res = await request(app).get('/admin/history');
    expect(res.body).toEqual({ messages: [] });
  });

  it('returns { messages: [...] } with data from readRecentMessages', async () => {
    const fakeMessages = [
      { id: '1', ts: 't', direction: 'in', type: 'buzz', socketId: 'x', payload: {} },
    ];
    mockReadRecentMessages.mockResolvedValueOnce(fakeMessages);
    const res = await request(app).get('/admin/history');
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].id).toBe('1');
  });

  it('calls readRecentMessages with argument 100', async () => {
    mockReadRecentMessages.mockClear();
    await request(app).get('/admin/history');
    expect(mockReadRecentMessages).toHaveBeenCalledWith(100);
  });

  it('returns 500 when readRecentMessages throws', async () => {
    mockReadRecentMessages.mockRejectedValueOnce(new Error('disk error'));
    const res = await request(app).get('/admin/history');
    expect(res.status).toBe(500);
  });
});
