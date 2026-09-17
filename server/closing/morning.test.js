import { describe, expect, it } from 'vitest';
import { BYMA_CALENDAR, CALENDAR_STATES, classifyBymaDate, previousTradingSession } from './calendar.js';
import { MORNING_POLICY_VERSION, MORNING_PRICE_POLICY,
  freezeMorningInputs, runMorning, VALUATION_SCOPE } from './morning.js';
import { MemoryStore } from './testSupport.js';

const INFORMATION_DATE = '2026-09-17';
const CAPTURED_AT = '2026-09-17T13:20:00.000Z';
const spec = {
  acciones: { currency: 'ARS', category: 1 },
  cedears: { currency: 'ARS', category: 23 },
  bonosARS: { currency: 'ARS', category: 3 },
  bonosUSD: { currency: 'USD', category: 3 },
  bonosEXT: { currency: 'EXT', category: 3 },
};
const quote = (group, symbol, previousClose, extra = {}) => {
  const { currency, category } = spec[group];
  return {
    symbol,
    security_id: `${symbol}-0002-C-CT-${currency}`,
    currency,
    market: 'CT',
    settlPeriod: '0002',
    operativeForm: 'C',
    category,
    previous_close: previousClose,
    closing_price: 999999,
    trade: 888888,
    trades: 777,
    Date: INFORMATION_DATE,
    broadcast_time: 94500,
    ...extra,
  };
};
const responses = () => ({
  acciones: { result: [quote('acciones', 'GGAL', 100), quote('acciones', 'YPFD', 200)] },
  cedears: { result: [quote('cedears', 'AAPL', 300)] },
  bonosARS: { result: [quote('bonosARS', 'AL30', 1200)] },
  bonosUSD: { result: [quote('bonosUSD', 'AL30D', 1.2)] },
  bonosEXT: { result: [quote('bonosEXT', 'AL30C', 1.1)] },
});
const positions = (ticker = 'GGAL', quantity = 1, extra = {}) => [{
  id: 'one',
  updateTime: 'position-v1',
  data: { debt: 0, assets: [{ ticker, quantity, ...extra }] },
}];
const byma = (source) => ({ fetchGroup: async (group) => structuredClone(source[group]) });
const execute = async ({ source = responses(), held = positions(), store = new MemoryStore(), now = CAPTURED_AT } = {}) => {
  const result = await runMorning({ informationDate: INFORMATION_DATE, store, byma: byma(source),
    loadPositions: async () => structuredClone(held), now: () => now, log: () => {} });
  return { result, store, snapshot: (await store.get('portfolioDailySnapshots/2026-09-16'))?.data };
};

describe('versioned BYMA 2026 calendar', () => {
  it('resolves a normal day to the immediately previous trading session', () => {
    expect(previousTradingSession('2026-09-17')).toBe('2026-09-16');
  });

  it('resolves Monday to Friday', () => {
    expect(previousTradingSession('2026-09-21')).toBe('2026-09-18');
  });

  it('skips a CLOSED holiday but retains the prior limited trading session', () => {
    expect(previousTradingSession('2026-03-25')).toBe('2026-03-23');
    expect(classifyBymaDate('2026-03-24').state).toBe(CALENDAR_STATES.CLOSED);
  });

  it('classifies a BYMA no-settlement trading day as LIMITED_WITH_TRADING', () => {
    expect(classifyBymaDate('2026-11-06').state).toBe(CALENDAR_STATES.LIMITED_WITH_TRADING);
  });

  it('fails closed outside the versioned year', () => {
    expect(() => previousTradingSession('2027-01-04')).toThrow('CALENDAR_UNKNOWN');
    expect(BYMA_CALENDAR).toMatchObject({ version: 'byma-trading-calendar-2026-v1', years: [2026], reviewedAt: '2026-09-17' });
  });
});

describe('morning previous-close valuation', () => {
  it('publishes a complete brokers-only snapshot when every previous_close exists', async () => {
    const { result, snapshot } = await execute();
    expect(result).toMatchObject({ status: 'COMPLETE', publicationStatus: 'PUBLISHED',
      informationDate: INFORMATION_DATE, valuationDate: '2026-09-16' });
    expect(snapshot).toMatchObject({ pricePolicy: MORNING_PRICE_POLICY, policyVersion: MORNING_POLICY_VERSION,
      valuationScope: 'BROKERS_ONLY', inputSource: 'brokerPositions', informationDate: INFORMATION_DATE,
      valuationDate: '2026-09-16', isComplete: true });
  });

  it('fails closed when a held ticker has no positive previous_close', async () => {
    const source = responses();
    source.acciones.result[0].previous_close = 0;
    await expect(execute({ source })).rejects.toMatchObject({ code: 'MISSING_REQUIRED_PREVIOUS_CLOSE' });
  });

  it('does not require a price for an exactly zero quantity', async () => {
    const source = responses();
    source.acciones.result[0].previous_close = 0;
    await expect(execute({ source, held: positions('GGAL', 0) })).resolves.toMatchObject({
      result: { publicationStatus: 'PUBLISHED' },
    });
  });

  it('requires a price for a negative quantity', async () => {
    const source = responses();
    source.acciones.result[0].previous_close = 0;
    await expect(execute({ source, held: positions('GGAL', -1) }))
      .rejects.toMatchObject({ code: 'MISSING_REQUIRED_PREVIOUS_CLOSE' });
  });

  it('rejects incompatible BYMA Date values across the five groups', async () => {
    const source = responses();
    source.bonosEXT.result[0].Date = '2026-09-16';
    await expect(execute({ source })).rejects.toMatchObject({ code: 'BYMA_INFORMATION_DATE_MISMATCH' });
  });

  it('computes MEP only from AL30 and AL30D previous_close of the same information date', async () => {
    const { snapshot } = await execute();
    expect(snapshot.rates.mep).toBe(1000);
    expect(snapshot.rates.mepSource).toEqual({ ars: 'AL30', usd: 'AL30D', priceType: 'PREVIOUS_CLOSE' });
    expect(snapshot.priceObservations.filter((item) => item.key.startsWith('fx:')).map((item) => [item.providerSymbol, item.previousClose]))
      .toEqual([['AL30', 1200], ['AL30D', 1.2]]);
  });

  it('does not publish when either MEP leg is missing', async () => {
    const source = responses();
    source.bonosUSD.result[0].previous_close = null;
    await expect(execute({ source })).rejects.toMatchObject({ code: 'MISSING_REQUIRED_PREVIOUS_CLOSE' });
  });

  it('repeating the same policy, positions and prices is an idempotent no-op', async () => {
    const store = new MemoryStore();
    expect((await execute({ store })).result.publicationStatus).toBe('PUBLISHED');
    const before = await store.get('portfolioDailySnapshots/2026-09-16');
    const repeated = await execute({ store, now: '2026-09-17T14:00:00.000Z' });
    expect(repeated.result.publicationStatus).toBe('NOOP');
    expect(await store.get('portfolioDailySnapshots/2026-09-16')).toEqual(before);
  });

  it('preserves an existing manual or incompatible snapshot and reports conflict', async () => {
    const store = new MemoryStore();
    await store.commit([{ path: 'portfolioDailySnapshots/2026-09-16', data: { source: 'manual', totals: { netUsd: 9 } } }]);
    await expect(execute({ store })).rejects.toMatchObject({ code: 'EXISTING_SNAPSHOT_CONFLICT' });
    expect((await store.get('portfolioDailySnapshots/2026-09-16')).data.source).toBe('manual');
  });

  it('has no Loans, Activos, Reclus or nonBrokerAssets input path', async () => {
    const input = freezeMorningInputs(positions());
    const { snapshot } = await execute();
    expect(VALUATION_SCOPE).toEqual({ name: 'BROKERS_ONLY', collection: 'brokerPositions' });
    expect(JSON.stringify({ input, snapshot })).not.toMatch(/nonBrokerAssets|reclus|loan/i);
  });

  it('never falls back to trade, closing_price or a cached local price', async () => {
    const source = responses();
    source.acciones.result[0] = quote('acciones', 'GGAL', 0, { trade: 500, closing_price: 600 });
    await expect(execute({ source, held: positions('GGAL', 1, { price: 700 }) }))
      .rejects.toMatchObject({ code: 'MISSING_REQUIRED_PREVIOUS_CLOSE' });
  });

  it('keeps Acciones and CEDEAR identity distinct', async () => {
    const source = responses();
    source.cedears.result.push(quote('cedears', 'GGAL', 90));
    await expect(execute({ source })).rejects.toMatchObject({ code: 'AMBIGUOUS_PREVIOUS_CLOSE' });
  });

  it('does not write brokerPositions as a valuation side effect', async () => {
    const { store } = await execute();
    expect(await store.list('brokerPositions')).toEqual([]);
    expect(await store.list('portfolioDailySnapshots')).toHaveLength(1);
  });
});
