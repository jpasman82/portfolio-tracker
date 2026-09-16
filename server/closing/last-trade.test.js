import { describe, expect, it } from 'vitest';
import { CAPTURE_POLICY, VERSION, PRICE_POLICY, normalize, capturePolicy, captureWindowReason, eligibleObservation, selectRequirement } from './model.js';
import { createRepository } from './repository.js';
import { runClose, buildFromDurable } from './pipeline.js';
import { MemoryStore, fixtureByma, row, position, DATE, NOW } from './testSupport.js';
import { observed, observedAt } from './fixtures/snapshot-2026-09-15.js';

const trade = (input = row('GGAL', 100), at = NOW) => normalize(input, 'acciones', DATE, at, 'test').find((o) => o.priceType === 'TRADE');
function setup(positions = [position()]) {
  const store = new MemoryStore();
  const clock = { value: NOW };
  const now = () => clock.value;
  const repo = createRepository(store, now);
  const byma = fixtureByma();
  const args = { date: DATE, repo, byma, loadPositions: async () => positions, publish: true, now, log: () => {} };
  return { store, repo, byma, args, clock, run: () => runClose(args) };
}

describe('daily last traded price: production contract', () => {
  it('accepts a positive dated/count-backed trade after cutoff and labels its provenance', () => {
    const o = trade();
    expect(o).toMatchObject({ status: 'VALID', price: 100, priceType: 'TRADE', priceDate: DATE,
      providerDate: DATE, valuationDate: DATE, tradeCount: 10, source: 'BYMA_SNAPSHOT', pricePolicy: PRICE_POLICY });
    expect(eligibleObservation(o, DATE)).toBe(true);
  });
  it.each([0, undefined, null])('missing/zero trade %s is NO_TRADE, never previous_close or closing_price', (value) => {
    const observations = normalize(row('GGAL', 0, 'ARS', { trade: value, previous_close: 999, closing_price: 888 }), 'acciones', DATE, NOW, 'a');
    expect(observations.find((o) => o.priceType === 'TRADE')).toMatchObject({ reason: 'NO_TRADE', status: 'REJECTED' });
    expect(observations.some((o) => o.status === 'VALID')).toBe(false);
    expect(observations.find((o) => o.priceType === 'PREVIOUS_CLOSE')).toMatchObject({ price: 999, priceDate: null, reason: 'REFERENCE_ONLY' });
  });
  it.each([undefined, null, -1, 1.5, '10', Infinity])('cannot infer operations from invalid count %s', (trades) => {
    expect(trade(row('GGAL', 100, 'ARS', { trades })).reason).toBe('UNKNOWN_TRADE_COUNT');
  });
  it('positive carried price with zero operations is explicitly NO_TRADE', () => {
    expect(trade(row('GGAL', 100, 'ARS', { trades: 0 })).reason).toBe('NO_TRADE');
  });
  it.each(['2026-09-14', '2026-09-16'])('rejects another provider session %s', (Date) => {
    expect(trade(row('GGAL', 100, 'ARS', { Date })).reason).toBe('WRONG_SESSION');
  });
  it.each([undefined, '', '2026-02-30', '16/09/2026'])('rejects unproven/invalid provider date %s', (Date) => {
    expect(trade(row('GGAL', 100, 'ARS', { Date })).reason).toBe('UNKNOWN_TRADE_DATE');
  });
  it.each([{ currency: 'USD' }, { currency: undefined }, { settlPeriod: '0001' }, { settlPeriod: undefined },
    { market: 'SB' }, { operativeForm: 'G' }, { category: 23 }, { security_id: 'OTHER-0002-C-CT-ARS' }])('rejects identity mismatch %j', (extra) => {
    expect(trade(row('GGAL', 100, 'ARS', extra)).reason).toBe('INVALID_IDENTITY');
  });
  it('does not use broadcast_time as execution time, cutoff or trade-date proof', () => {
    expect(trade(row('GGAL', 100, 'ARS', { broadcast_time: 92505 })).status).toBe('VALID');
    expect(trade(row('GGAL', 100, 'ARS', { Date: undefined, broadcast_time: 181001 })).status).toBe('REJECTED');
  });
  it('pre-cutoff rejection cannot deduplicate a later eligible capture', () => {
    const early = trade(row('GGAL', 100), '2026-09-15T20:59:59Z');
    const late = trade(row('GGAL', 100), '2026-09-15T21:10:00Z');
    expect(early.reason).toBe('BEFORE_CAPTURE_CUTOFF'); expect(late.status).toBe('VALID');
    expect(early.id).not.toBe(late.id);
  });
  it('deduplicates identical eligible evidence across later retries', () => {
    expect(trade(row('GGAL', 100), '2026-09-15T21:10:00Z').id).toBe(trade(row('GGAL', 100), '2026-09-15T22:35:00Z').id);
  });
  it('honors ART date, not UTC date, and rejects rollover/backfill', () => {
    expect(captureWindowReason(DATE, '2026-09-16T02:59:59Z')).toBeNull();
    expect(captureWindowReason(DATE, '2026-09-16T03:00:00Z')).toBe('WRONG_CAPTURE_SESSION');
    expect(captureWindowReason(DATE, '2026-09-15T20:59:59Z')).toBe('BEFORE_CAPTURE_CUTOFF');
    expect(captureWindowReason(DATE, '2026-09-15T21:00:00Z')).toBeNull();
    expect(captureWindowReason(DATE, 'bad')).toBe('INVALID_CAPTURE_TIME');
    expect(captureWindowReason('2026-09-19', '2026-09-19T22:00:00Z')).toBe('NON_TRADING_WEEKDAY');
  });
  it('cutoff can move later but never earlier through env configuration', () => {
    expect(capturePolicy({})).toEqual(CAPTURE_POLICY);
    expect(capturePolicy({ PORTFOLIO_CAPTURE_CUTOFF_ART: '19:00' }).cutoffART).toBe('19:00');
    for (const value of ['17:59', '', '25:00', '6:00', 'disabled']) {
      expect(() => capturePolicy({ PORTFOLIO_CAPTURE_CUTOFF_ART: value })).toThrow('INVALID_CAPTURE_CUTOFF');
    }
  });
  it('real intraday fixtures stay ineligible; simulated post-cutoff fixtures cover five groups', () => {
    for (const { group, row: actual } of observed) {
      const before = normalize(actual, group, DATE, observedAt, 'observed').find((o) => o.priceType === 'TRADE');
      expect(before.status).toBe('REJECTED');
      const simulated = normalize(actual, group, DATE, NOW, 'SIMULATED-post-cutoff').find((o) => o.priceType === 'TRADE');
      expect(simulated.status).toBe(actual.symbol === 'POLL' ? 'REJECTED' : 'VALID');
      if (actual.symbol === 'POLL') expect(simulated.reason).toBe('NO_TRADE');
    }
  });
});

describe('last-trade pipeline and durable recovery', () => {
  it.each([0, 1, -1])('zero vs signed quantities with an explicit NO_TRADE row: %s', async (quantity) => {
    const s = setup([position('GGAL', quantity)]);
    s.byma.responses.acciones = [row('GGAL', 0, 'ARS', { previous_close: 999 })];
    const result = await s.run();
    expect(result.status).toBe(quantity === 0 ? 'COMPLETE' : 'PARTIAL');
    if (quantity !== 0) {
      expect(result.rejected).toContainEqual({ key: 'acciones+cedears:GGAL', reason: 'NO_TRADE' });
      expect(await s.store.get(`portfolioDailySnapshots/${DATE}`)).toBeNull();
    }
  });
  it('first valid capture survives shared-group retry; missing trade completes later', async () => {
    const s = setup([{ id: 'one', data: { assets: [{ ticker: 'GGAL', quantity: 1 }, { ticker: 'YPFD', quantity: 1 }] } }]);
    s.byma.responses.acciones.push(row('YPFD', 0));
    const first = await s.run();
    expect(first.status).toBe('PARTIAL'); expect(first.valid).toHaveLength(3);
    const selected = { ...first.selected };
    s.clock.value = '2026-09-15T22:35:00Z';
    s.byma.responses.acciones = [row('GGAL', 0), row('YPFD', 300)];
    const second = await s.run();
    expect(second.status).toBe('COMPLETE'); expect(second.selected).toMatchObject(selected);
    const snapshot = (await s.store.get(`portfolioDailySnapshots/${DATE}`)).data;
    expect(snapshot).toMatchObject({ pricePolicy: PRICE_POLICY, priceSource: 'BYMA_SNAPSHOT', dailyPriceDefinition: 'daily last traded price', policyVersion: VERSION });
    expect(snapshot.priceObservations.every((o) => o.priceType === 'TRADE' && o.providerDate === DATE && o.tradeCount > 0)).toBe(true);
  });
  it('restart after observations and group checkpoints, before selection, needs no refetch', async () => {
    const s = setup();
    let once = true;
    s.store.beforeCommit = async (writes) => {
      if (once && writes[0].data.stage === 'BUILD') {
        once = false; throw Object.assign(new Error('Crash before selection commit'), { httpStatus: 403 });
      }
    };
    await expect(s.run()).rejects.toThrow();
    expect((await s.repo.observations(DATE)).filter((o) => o.status === 'VALID')).toHaveLength(3);
    s.args.repo = createRepository(s.store, () => s.clock.value);
    s.args.byma = { fetchGroup: () => { throw new Error('must use durable observations'); } };
    s.args.loadPositions = () => { throw new Error('must use frozen inputs'); };
    expect((await s.run()).status).toBe('COMPLETE');
  });
  it('restart before a group checkpoint preserves a saved trade despite a worse retry', async () => {
    const s = setup();
    const endpoint = s.repo.endpoint;
    let once = true;
    s.repo.endpoint = async (...args) => {
      if (once && args[2] === 'acciones' && args[3].status === 'OK') { once = false; throw new Error('lost checkpoint'); }
      return endpoint(...args);
    };
    expect((await s.run()).status).toBe('PARTIAL');
    const saved = (await s.repo.observations(DATE)).find((o) => o.providerSymbol === 'GGAL' && o.status === 'VALID');
    s.args.repo = createRepository(s.store, () => s.clock.value);
    s.clock.value = '2026-09-15T22:35:00Z'; s.byma.responses.acciones = [row('GGAL', 0)];
    const result = await s.run();
    expect(result.status).toBe('COMPLETE'); expect(result.selected['acciones+cedears:GGAL']).toBe(saved.id);
  });
  it('first post-cutoff eligible price wins after restart, but simultaneous conflicting prices are ambiguous', () => {
    const requirement = { groups: ['acciones'], symbols: ['GGAL'] };
    const a = trade(row('GGAL', 100), '2026-09-15T21:10:00Z');
    const b = trade(row('GGAL', 101), '2026-09-15T22:35:00Z');
    expect(selectRequirement(requirement, [b, a], DATE).observation.id).toBe(a.id);
    expect(selectRequirement(requirement, [a, { ...b, capturedAt: a.capturedAt }], DATE).reason).toBe('AMBIGUOUS_QUOTE');
  });
  it('invalid durable evidence cannot be published merely by marking it VALID', async () => {
    const s = setup(); s.args.publish = false;
    const state = await s.run();
    const input = await s.repo.input(DATE);
    const observations = await s.repo.observations(DATE);
    const id = state.selected['acciones+cedears:GGAL'];
    for (const patch of [{ source: 'BYMA_EOD' }, { priceType: 'CLOSING_PRICE' }, { tradeCount: 0 },
      { providerDate: '2026-09-14' }, { capturedAt: observedAt }, { settlement: '0001' }]) {
      await expect(buildFromDurable(input, state.selected, observations.map((o) => o.id === id ? { ...o, ...patch } : o), DATE, NOW))
        .rejects.toMatchObject({ code: 'MISSING_REQUIRED_INPUT' });
    }
  });
  it('early invocation causes no provider calls, frozen inputs, lease or production-style writes', async () => {
    const s = setup(); s.clock.value = '2026-09-15T20:00:00Z';
    await expect(s.run()).rejects.toMatchObject({ code: 'BEFORE_CAPTURE_CUTOFF' });
    expect(s.byma.calls).toEqual([]); expect(s.store.documents.size).toBe(0);
  });
  it('an old policy run cannot silently become last-trade history', async () => {
    const s = setup();
    await s.store.commit([{ path: `marketPriceRuns/${DATE}`, data: { policyVersion: 'b1-v1' } }]);
    await expect(s.run()).rejects.toMatchObject({ code: 'POLICY_VERSION_MISMATCH' });
    expect(s.byma.calls).toEqual([]);
  });
});
