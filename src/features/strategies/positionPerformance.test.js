import { describe, expect, it } from 'vitest';
import { positionPerformance } from './strategyUi.js';

describe('position performance in the selected currency', () => {
  it('compares the remaining cost at the initial exchange rate with the current market value', () => {
    const position = { currency: 'ARS', quantity: '10', costBasis: '10000', priceDivisor: '1' };
    expect(positionPerformance(position, '1500', 'USD', '1500', '1000')).toEqual({ initial: '10', current: '10', result: '0', returnPct: 0 });
    expect(positionPerformance(position, '1500', 'ARS', '1500', '1000')).toEqual({ initial: '10000', current: '15000', result: '5000', returnPct: 50 });
  });

  it('respects bond prices per hundred and handles a zero cost', () => {
    const position = { currency: 'USD', quantity: '100', costBasis: '120', priceDivisor: '100' };
    expect(positionPerformance(position, '100', 'USD', '1500', '1000')).toEqual({ initial: '120', current: '100', result: '-20', returnPct: expect.closeTo(-16.6666667, 5) });
    expect(positionPerformance({ ...position, costBasis: '0' }, '100', 'USD', '1500', '1000').returnPct).toBeNull();
  });
});
