import { describe, expect, it, vi } from 'vitest';
import { createBymaClient } from './byma.js';

const response = (body) => ({ ok: true, status: 200, json: async () => body });

describe('BYMA morning settlement fallback', () => {
  it('keeps 0002 rows primary and adds only symbols absent there from 0001', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/oauth/token/')) return response({ access_token: 'test-token' });
      if (url.includes('settlPeriod=0002')) return response({ result: [
        { symbol: 'AL30', previous_close: 100 }, { symbol: 'GD30', previous_close: 90 },
      ] });
      if (url.includes('settlPeriod=0001')) return response({ result: [
        { symbol: 'GD30', previous_close: 80 }, { symbol: 'CO26', previous_close: 50 },
      ] });
      throw new Error(`Unexpected URL ${url}`);
    });
    const result = await createBymaClient({
      env: { BYMA_CLIENT_ID: 'id', BYMA_CLIENT_SECRET: 'secret' }, fetchImpl,
    }).fetchGroup('bonosARS', { fallbackSettlement: '0001' });
    expect(result.result).toEqual([
      { symbol: 'AL30', previous_close: 100 },
      { symbol: 'GD30', previous_close: 90 },
      { symbol: 'CO26', previous_close: 50 },
    ]);
  });
});
