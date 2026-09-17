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

  it('reports every missing requirement with safe broker, mapping and identity diagnostics', async () => {
    const source = responses();
    source.acciones.result[0].previous_close = 0;
    source.bonosUSD.result[0].previous_close = null;
    let failure;
    try { await execute({ source, held: positions('GGAL', -2) }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'MISSING_REQUIRED_PREVIOUS_CLOSE' });
    expect(failure.details.missing).toHaveLength(2);
    expect(failure.details.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({ requirementKey: 'acciones+cedears:GGAL', ticker: 'GGAL',
        groups: ['acciones', 'cedears'], positions: [{ broker: 'one', quantity: -2,
          localTicker: 'GGAL', providerSymbol: 'GGAL' }], reasons: ['MISSING_PREVIOUS_CLOSE'],
        candidates: [expect.objectContaining({ providerSymbol: 'GGAL', previousClose: 0,
          currency: 'ARS', settlement: '0002', market: 'CT', operativeForm: 'C', category: 1 })] }),
      expect.objectContaining({ requirementKey: 'fx:MEP:USD', ticker: 'AL30D', groups: ['bonosUSD'],
        positions: [], reasons: ['MISSING_PREVIOUS_CLOSE'] }),
    ]));
  });

  it('reports BYMA_ROW_NOT_FOUND when the expected provider symbol is absent', async () => {
    const source = responses();
    source.acciones.result = source.acciones.result.filter((item) => item.symbol !== 'GGAL');
    let failure;
    try { await execute({ source }); } catch (error) { failure = error; }
    expect(failure.details.missing).toContainEqual(expect.objectContaining({
      ticker: 'GGAL', reasons: ['BYMA_ROW_NOT_FOUND'], candidates: [],
    }));
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

  it('values PESOS and CABLE as explicit broker cash balances without cached prices', async () => {
    const held = [{ id: 'balanz', data: { debt: 0, assets: [
      { ticker: 'PESOS', quantity: 1000, price: 999999 },
      { ticker: 'CABLE', quantity: 2, price: 999999 },
    ] } }];
    const { snapshot } = await execute({ held });
    expect(snapshot.rates).toMatchObject({ mep: 1000, cable: 1200 / 1.1 });
    expect(snapshot.brokers[0].assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ ticker: 'PESOS', unitPrice: 1, unitPriceUsd: 0.001 }),
      expect.objectContaining({ ticker: 'CABLE', unitPrice: 1200 / 1.1, unitPriceUsd: (1200 / 1.1) / 1000 }),
    ]));
    expect(snapshot.priceObservations).toContainEqual(expect.objectContaining({
      key: 'fx:CABLE:EXT', providerSymbol: 'AL30C', previousClose: 1.1,
    }));
  });

  it('maps JPM USD bonds explicitly and converts ARS-only bond symbols with same-session MEP', async () => {
    const source = responses();
    for (const symbol of ['AE38D', 'AL35D', 'AL41D', 'CO26D', 'GD35D', 'TU27D']) {
      source.bonosUSD.result.push(quote('bonosUSD', symbol, 2));
    }
    for (const symbol of ['BA37D', 'BB37D', 'BC37D']) {
      source.bonosARS.result.push(quote('bonosARS', symbol, 2000));
    }
    const held = [{ id: 'jpm', data: { debt: 0, assets:
      ['AE38', 'AL30', 'AL35', 'AL41', 'CO26', 'GD35', 'TFU27', 'BA37D', 'BB37D', 'BC37D']
        .map((ticker) => ({ ticker, quantity: 100, isBond: true })) } }];
    const { snapshot } = await execute({ source, held });
    const observations = new Map(snapshot.priceObservations.map((item) => [item.key, item]));
    expect(observations.get('bonosUSD:AE38D')).toMatchObject({ providerSymbol: 'AE38D', group: 'bonosUSD' });
    expect(observations.get('bonosUSD:AL30D')).toMatchObject({ providerSymbol: 'AL30D', group: 'bonosUSD' });
    expect(observations.get('bonosUSD:TU27D')).toMatchObject({ providerSymbol: 'TU27D', group: 'bonosUSD' });
    expect(observations.get('bonosARS:BA37D')).toMatchObject({ providerSymbol: 'BA37D', group: 'bonosARS' });
    expect(snapshot.brokers[0].assets.find((asset) => asset.ticker === 'AE38').unitPriceUsd).toBe(0.02);
    expect(snapshot.brokers[0].assets.find((asset) => asset.ticker === 'BA37D').unitPriceUsd).toBe(0.02);
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
    await expect(execute({ source })).rejects.toMatchObject({
      code: 'MISSING_REQUIRED_PREVIOUS_CLOSE',
      details: {
        missing: [expect.objectContaining({ reasons: ['AMBIGUOUS_PREVIOUS_CLOSE'] })],
      },
    });
  });

  it('does not write brokerPositions as a valuation side effect', async () => {
    const { store } = await execute();
    expect(await store.list('brokerPositions')).toEqual([]);
    expect(await store.list('portfolioDailySnapshots')).toHaveLength(1);
  });
});
