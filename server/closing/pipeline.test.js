import { describe, it, expect } from 'vitest';
import { createRepository, createRestStore } from './repository.js';
import { runClose, buildFromDurable } from './pipeline.js';
import { normalize, freezeInputs } from './model.js';
import { MemoryStore, fixtureByma, row, position, DATE, NOW } from './testSupport.js';

function setup({ positions = [position()], byma = fixtureByma(), archive, build, publish = true } = {}) {
  const store = new MemoryStore();
  const clock = { value: NOW };
  const now = () => clock.value;
  const repo = createRepository(store, now);
  const args = { date: DATE, repo, byma, loadPositions: async () => positions, publish,
    now, log: () => {}, archive, ...(build ? { build } : {}) };
  return { store, repo, args, clock, byma, run: () => runClose(args),
    snapshot: async () => (await store.get(`portfolioDailySnapshots/${DATE}`))?.data };
}

describe('B1 required failure scenarios', () => {
  it('1 all required prices -> COMPLETE, durable inputs and final snapshot', async () => {
    const s = setup();
    const result = await s.run();
    expect(result.status).toBe('COMPLETE');
    expect(result.valid).toHaveLength(3);
    expect(result.archiveStatus).toBe('NOT_CONFIGURED');
    expect((await s.snapshot()).totals.netUsd).toBe(0.1);
    expect((await s.repo.input(DATE)).positions[0].data.assets[0]).not.toHaveProperty('price');
  });
  it('2 missing required symbol -> PARTIAL; successful prices remain durable', async () => {
    const s = setup({ positions: [position('MISSING')] });
    const result = await s.run();
    expect(result.status).toBe('PARTIAL');
    expect(result.valid).toHaveLength(2);
    expect((await s.repo.observations(DATE)).filter((o) => o.status === 'VALID')).toHaveLength(2);
    expect(await s.snapshot()).toBeUndefined();
  });
  it('3 absent zero position is not required', async () => {
    const s = setup({ positions: [position('MISSING', 0)] });
    const result = await s.run();
    expect(result.status).toBe('COMPLETE');
    expect(result.expectedQuoteKeys.some((key) => key.includes('MISSING'))).toBe(false);
  });
  it('4 negative quantity still requires a price', async () => {
    const s = setup({ positions: [position('MISSING', -3)] });
    expect((await s.run()).status).toBe('PARTIAL');
    expect(await s.snapshot()).toBeUndefined();
  });
  it('5 previous_close is preserved but rejected, never dated from capture time', async () => {
    const observations = normalize(row('GGAL', 0, 'ARS', { previous_close: 99 }), 'acciones', DATE, NOW, 'a');
    const previous = observations.find((o) => o.priceType === 'PREVIOUS_CLOSE');
    expect(previous).toMatchObject({ price: 99, valuationDate: DATE, priceDate: null, stale: true, status: 'REJECTED' });
    const s = setup();
    s.byma.responses.acciones = [row('GGAL', 0, 'ARS', { previous_close: 99 })];
    expect((await s.run()).status).toBe('PARTIAL');
    expect(await s.snapshot()).toBeUndefined();
  });
  it('6 failed BYMA group does not discard other responses', async () => {
    const s = setup({ byma: fixtureByma({ acciones: async () => { throw Object.assign(new Error('No'), { code: 'BYMA_GROUP_FAILED' }); } }) });
    const result = await s.run();
    expect(result.status).toBe('PARTIAL');
    expect(result.endpointResults.acciones.status).toBe('FAILED');
    expect(result.endpointResults.acciones.error.stage).toBe('BYMA:acciones');
    expect((await s.repo.observations(DATE)).some((o) => o.providerSymbol === 'AL30')).toBe(true);
  });
  it('7 retry completes PARTIAL, retains previous valid observations and frozen inputs', async () => {
    const s = setup();
    s.byma.responses.acciones = [];
    expect((await s.run()).status).toBe('PARTIAL');
    const prior = (await s.repo.observations(DATE)).map((o) => o.id);
    s.args.loadPositions = async () => { throw new Error('Retry must use frozen inputs'); };
    s.args.repo = createRepository(s.store, () => s.clock.value); // Simulated cold start.
    s.byma.calls.length = 0;
    s.byma.responses.acciones = [row('GGAL', 100)];
    expect((await s.run()).status).toBe('COMPLETE');
    expect(s.byma.calls.sort()).toEqual(['acciones', 'cedears']);
    expect((await s.repo.observations(DATE)).map((o) => o.id)).toEqual(expect.arrayContaining(prior));
  });
  it('8 repeat capture is idempotent, with no logical duplicates', async () => {
    const s = setup();
    await s.run();
    const snapshot = await s.snapshot();
    const count = (await s.repo.observations(DATE)).length;
    s.byma.calls.length = 0;
    await s.run();
    expect(await s.snapshot()).toEqual(snapshot);
    expect((await s.repo.observations(DATE)).length).toBe(count);
    expect(s.byma.calls).toEqual([]);
  });
  it('9 only the current lease can consolidate; expired worker cannot publish', async () => {
    const s = setup();
    const first = await s.repo.acquire(DATE, 'first');
    await expect(s.repo.acquire(DATE, 'second')).rejects.toMatchObject({ code: 'LEASE_BUSY' });
    s.clock.value = '2026-09-15T22:02:00.000Z';
    const second = await s.repo.acquire(DATE, 'second');
    expect(second.lease.token).toBe(first.lease.token + 1);
    await expect(s.repo.publish(DATE, first.lease, { b1BuildId: 'old' }, {})).rejects.toMatchObject({ code: 'LEASE_LOST' });
    expect(await s.snapshot()).toBeUndefined();
  });
  it('10 builder failure after durable prices -> persisted observations survive and retry reuses them', async () => {
    const s = setup({ build: async () => { throw Object.assign(new Error('Fail'), { code: 'BUILD_FAILED' }); } });
    await expect(s.run()).rejects.toMatchObject({ code: 'BUILD_FAILED' });
    expect((await s.repo.observations(DATE)).filter((o) => o.status === 'VALID')).toHaveLength(3);
    expect((await s.store.get(`marketPriceRuns/${DATE}`)).data.status).toBe('FAILED');
    s.args.build = buildFromDurable;
    s.byma.calls.length = 0;
    expect((await s.run()).status).toBe('COMPLETE');
    expect(s.byma.calls).toEqual([]);
  });
  it('11 optional archive failure does not invalidate economic COMPLETE', async () => {
    const s = setup({ archive: { put: async () => { throw new Error('Archive down'); } } });
    const result = await s.run();
    expect(result.status).toBe('COMPLETE');
    expect(result.archiveStatus).toBe('FAILED');
    expect((await s.snapshot()).isComplete).toBe(true);
  });
  it('12 no final snapshot when mandatory FX is missing', async () => {
    const s = setup();
    s.byma.responses.bonosUSD = [];
    expect((await s.run()).status).toBe('PARTIAL');
    expect(await s.snapshot()).toBeUndefined();
  });
});

describe('B1 additional safety boundaries', () => {
  it('detects client/legacy overwrite on a repeated published run without rewriting history', async () => {
    const s = setup();
    await s.run();
    const target = `portfolioDailySnapshots/${DATE}`;
    const prior = await s.store.get(target);
    await s.store.commit([{ path: target, data: { source: 'manual' }, version: prior.version }]);
    await expect(s.run()).rejects.toMatchObject({ code: 'PUBLISHED_SNAPSHOT_CHANGED' });
    expect(await s.snapshot()).toEqual({ source: 'manual' });
  });
  it('a malformed row cannot discard the other valid rows in its group', async () => {
    const s = setup();
    s.byma.responses.acciones.unshift(null);
    expect((await s.run()).status).toBe('COMPLETE');
  });
  it('detects a merge-style client overwrite that retains the original b1BuildId', async () => {
    const s = setup();
    await s.run();
    const target = `portfolioDailySnapshots/${DATE}`;
    const prior = await s.store.get(target);
    await s.store.commit([{ path: target, data: { ...prior.data, totals: { netUsd: 999 } }, version: prior.version }]);
    await expect(s.run()).rejects.toMatchObject({ code: 'PUBLISHED_SNAPSHOT_CHANGED' });
  });
  it('production contract accepts only the daily trade, never reference closing prices', () => {
    const actual = normalize(row('GGAL', 100), 'acciones', DATE, NOW, 'a');
    expect(actual.filter((o) => o.status === 'VALID').map((o) => o.priceType)).toEqual(['TRADE']);
    expect(actual[0]).toMatchObject({ priceDate: null, reason: 'REFERENCE_ONLY' });
  });
  it('real BYMA response enums stay distinct from request parameters', () => {
    const o = normalize(row('GGAL', 100, 'ARS', { market: 'CT', operativeForm: 'C' }), 'acciones', DATE, NOW, 'a').find((o) => o.priceType === 'TRADE');
    expect(o).toMatchObject({ market: 'CT', operativeForm: 'C', requestedOperativeForm: 'CONTADO', status: 'VALID' });
  });
  it('positive trade without positive count is NO_TRADE and cannot date previous_close', () => {
    const observations = normalize(row('GGAL', 0, 'ARS', { trade: 6795 }), 'acciones', DATE, NOW, 'a');
    expect(observations.find((o) => o.priceType === 'TRADE')).toMatchObject({ priceDate: null,
      status: 'REJECTED', reason: 'NO_TRADE' });
    expect(observations.find((o) => o.priceType === 'PREVIOUS_CLOSE').priceDate).toBeNull();
  });
  it('ARS and USD representations of a held ticker are not merged into one market price row', async () => {
    const s = setup({ positions: [position(), { ...position(), id: 'jpm' }] });
    await s.run();
    expect((await s.snapshot()).marketPrices.map((p) => [p.currency, p.unitPrice]).sort(([a], [b]) => a.localeCompare(b)))
      .toEqual([['ARS', 100], ['USD', 0.1]]);
  });
  it('native USD bond alias is scoped to its currency and keeps baseline per-100 valuation', async () => {
    const s = setup({ positions: [{ id: 'jpm', data: { assets: [{ ticker: 'TFU27', quantity: 10 }] } }] });
    s.byma.responses.bonosUSD.push(row('TU27D', 100, 'USD'));
    expect((await s.run()).status).toBe('COMPLETE');
    expect((await s.snapshot()).totals.netUsd).toBe(10);
  });
  it('mixed raw archive outcomes are DEGRADED, independent of economic COMPLETE', async () => {
    const s = setup({ archive: { put: async ({ group }) => { if (group === 'acciones') throw new Error('No raw'); } } });
    const result = await s.run();
    expect(result).toMatchObject({ status: 'COMPLETE', archiveStatus: 'DEGRADED' });
  });
  it('rejects wrong trade session, currency and settlement', () => {
    for (const extra of [{ Date: '2026-09-14' }, { currency: 'USD' }, { settlPeriod: '0001' }]) {
      expect(normalize(row('GGAL', 100, 'ARS', extra), 'acciones', DATE, NOW, 'a').find((o) => o.priceType === 'TRADE').status).toBe('REJECTED');
    }
  });
  it('does not collapse same ticker in different segments or security IDs', async () => {
    const s = setup();
    s.byma.responses.cedears = [row('GGAL', 90, 'ARS', { category: 23 })];
    const state = await s.run();
    expect(state.rejected).toContainEqual({ key: 'acciones+cedears:GGAL', reason: 'AMBIGUOUS_QUOTE' });
    expect(await s.snapshot()).toBeUndefined();
  });
  it('never replaces a selected good close with a rejected/older close from a shared-group retry', async () => {
    const s = setup({ positions: [{ id: 'one', data: { assets: [{ ticker: 'GGAL', quantity: 1 }, { ticker: 'YPFD', quantity: 1 }] } }] });
    const initial = await s.run();
    const good = initial.selected['acciones+cedears:GGAL'];
    s.byma.responses.acciones = [row('GGAL', 0), row('YPFD', 300)];
    const final = await s.run();
    expect(final.status).toBe('COMPLETE');
    expect(final.selected['acciones+cedears:GGAL']).toBe(good);
  });
  it('uncertain publication ACK reconciles without duplicate or false failure', async () => {
    const s = setup();
    let once = true;
    s.store.afterCommit = async (writes) => {
      if (once && writes.some((w) => w.path.startsWith('portfolioDailySnapshots/'))) {
        once = false;
        throw new Error('Lost commit ACK');
      }
    };
    expect((await s.run()).status).toBe('COMPLETE');
    expect((await s.store.list('portfolioDailySnapshots')).length).toBe(1);
  });
  it('preserves an existing legacy/client snapshot, refusing overwrite', async () => {
    const s = setup();
    await s.store.commit([{ path: `portfolioDailySnapshots/${DATE}`, data: { source: 'manual' } }]);
    await expect(s.run()).rejects.toMatchObject({ code: 'EXISTING_SNAPSHOT_CONFLICT' });
    expect(await s.snapshot()).toEqual({ source: 'manual' });
    expect((await s.repo.observations(DATE)).length).toBeGreaterThan(0);
  });
  it('capture-only mode does not publish, and later publication needs no BYMA', async () => {
    const s = setup({ publish: false });
    expect((await s.run()).status).toBe('COMPLETE');
    expect(await s.snapshot()).toBeUndefined();
    s.args.publish = true;
    s.byma.calls.length = 0;
    expect((await s.run()).publicationStatus).toBe('PUBLISHED');
    expect(s.byma.calls).toEqual([]);
  });
  it('malformed quantities cannot silently become zero', () => {
    for (const quantity of [undefined, NaN, Infinity, 'broken', '']) {
      expect(() => freezeInputs([position('GGAL', 1, { quantity })], NOW)).toThrow();
    }
  });
  it('simultaneous acquisition has exactly one winner', async () => {
    const s = setup();
    const results = await Promise.allSettled([s.repo.acquire(DATE, 'a'), s.repo.acquire(DATE, 'b')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('does not persist any normalized observation unless the fenced commit succeeds', async () => {
    const s = setup();
    s.store.beforeCommit = async (writes) => {
      if (writes.some((w) => w.path.includes('/observations/'))) throw Object.assign(new Error('Denied'), { httpStatus: 403 });
    };
    const result = await s.run();
    expect(result.status).toBe('FAILED');
    expect(result.endpointResults.acciones.error.stage).toBe('PERSIST_OBSERVATIONS:acciones');
    expect(await s.repo.observations(DATE)).toEqual([]);
    expect(await s.snapshot()).toBeUndefined();
  });
  it('emulator transport refuses non-demo project IDs', () => {
    expect(() => createRestStore({ projectId: 'production', emulatorHost: '127.0.0.1:8080' })).toThrow('UNSAFE_EMULATOR_TARGET');
  });
});
