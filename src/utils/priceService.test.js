import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ bymaGet: vi.fn() }));

vi.mock('./bymaService', () => ({ bymaGet: mocks.bymaGet }));
vi.mock('./marketHours', () => ({ esMercadoAbierto: () => true }));

import { fetchAllPrices, getBrokerLivePrice } from './priceService.js';

const quote = (symbol, trade, previous_close = trade) => ({ symbol, trade, previous_close });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
  mocks.bymaGet.mockImplementation(async (endpoint) => {
    if (endpoint.includes('currency=ARS&settlPeriod=0002')) {
      return { result: [quote('AL30', 90000), quote('GD30', 88000)] };
    }
    if (endpoint.includes('currency=USD&settlPeriod=0002')) {
      return { result: [quote('AL30D', 60), quote('GD30', 58)] };
    }
    if (endpoint.includes('currency=EXT&settlPeriod=0002')) {
      return { result: [quote('AL30C', 55)] };
    }
    if (endpoint.includes('currency=ARS&settlPeriod=0001')) {
      return { result: [quote('CO26', 0, 5089), quote('GD30', 87000)] };
    }
    if (endpoint.includes('currency=USD&settlPeriod=0001')) {
      return { result: [quote('CO26D', 0, 3.8537), quote('GD30', 57)] };
    }
    return { result: [] };
  });
});

describe('BYMA settlement coverage', () => {
  it('uses 0001 as a fallback without replacing quotes available in 0002', async () => {
    const prices = await fetchAllPrices();
    expect(prices.CO26).toBe(5089);
    expect(prices.CO26D).toBe(3.8537);
    expect(prices.GD30).toBe(58);
    expect(mocks.bymaGet).toHaveBeenCalledWith(expect.stringContaining('settlPeriod=0001'));
  });

  it('maps the USD broker CO26 holding to the CO26D quote', async () => {
    const prices = await fetchAllPrices();
    expect(getBrokerLivePrice('CO26', prices, { isUSD: true, mepRate: 1500 })).toBe(3.8537);
  });
});
