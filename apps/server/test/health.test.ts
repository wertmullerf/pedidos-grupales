import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useTestApp } from './helpers.js';

describe('GET /health', () => {
  const ctx = useTestApp();

  it('responde ok cuando Postgres y Redis están disponibles', async () => {
    const res = await request(ctx.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', instance: 'test', db: 'ok', redis: 'ok' });
  });
});
