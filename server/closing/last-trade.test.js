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
  it('restart after observations and group checkpoints reconciles durable evidence and refetches the window', async () => {
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
    s.args.loadPositions = () => { throw new Error('must use frozen inputs'); };
    expect((await s.run()).status).toBe('COMPLETE');
    expect(s.byma.calls.length).toBeGreaterThan(4);
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
  it('maximum operation count wins; equal count with different prices is an explicit conflict', () => {
    const requirement = { groups: ['acciones'], symbols: ['GGAL'] };
    const a = trade(row('GGAL', 100), '2026-09-15T21:10:00Z');
    const b = trade(row('GGAL', 101, 'ARS', { trades: 11 }), '2026-09-15T22:35:00Z');
    expect(selectRequirement(requirement, [b, a], DATE, a.id)).toMatchObject({
      observation: { id: b.id }, outcome: 'UPDATED_MORE_TRADES', blocking: false,
    });
    const conflict = trade(row('GGAL', 102, 'ARS', { trades: 11 }), '2026-09-15T22:36:00Z');
    expect(selectRequirement(requirement, [a, b, conflict], DATE, b.id)).toMatchObject({
      observation: { id: b.id }, reason: 'TRADE_COUNT_PRICE_CONFLICT', blocking: true,
    });
  });
  it('a later eligible capture with more operations replaces the selection and preserves both observations', async () => {
    const s = setup(); s.args.publish = false;
    const first = await s.run();
    const firstId = first.selected['acciones+cedears:GGAL'];
    s.clock.value = '2026-09-15T22:35:00Z';
    s.byma.responses.acciones = [row('GGAL', 101, 'ARS', { trades: 11 })];
    const second = await s.run();
    const secondId = second.selected['acciones+cedears:GGAL'];
    expect(secondId).not.toBe(firstId);
    expect(second.reconciliation['acciones+cedears:GGAL']).toMatchObject({
      selectedObservationId: secondId, selectedTradeCount: 11, selectedTrade: 101,
      lastOutcome: 'UPDATED_MORE_TRADES',
      lastSelectionChange: { fromObservationId: firstId, toObservationId: secondId, reason: 'MORE_TRADES' },
    });
    const ids = (await s.repo.observations(DATE)).map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining([firstId, secondId]));
  });
  it('an identical later response is a no-op and creates no logical duplicate', async () => {
    const s = setup(); s.args.publish = false;
    const first = await s.run();
    const count = (await s.repo.observations(DATE)).length;
    s.clock.value = '2026-09-15T22:35:00Z';
    const second = await s.run();
    expect(second.selected).toEqual(first.selected);
    expect(second.reconciliation['acciones+cedears:GGAL'].lastOutcome).toBe('UNCHANGED');
    expect(await s.repo.observations(DATE)).toHaveLength(count);
  });
  it('a later lower operation count is retained as evidence but cannot move the selection backwards', async () => {
    const s = setup(); s.args.publish = false;
    const first = await s.run();
    const selectedId = first.selected['acciones+cedears:GGAL'];
    s.clock.value = '2026-09-15T22:35:00Z';
    s.byma.responses.acciones = [row('GGAL', 99, 'ARS', { trades: 9 })];
    const second = await s.run();
    expect(second.status).toBe('COMPLETE');
    expect(second.selected['acciones+cedears:GGAL']).toBe(selectedId);
    expect(second.reconciliationAnomalies).toContainEqual(expect.objectContaining({
      key: 'acciones+cedears:GGAL', type: 'TRADE_COUNT_REGRESSION', tradeCount: 9, priorMaxTradeCount: 10,
    }));
    expect((await s.repo.observations(DATE)).some((o) => o.tradeCount === 9 && o.price === 99)).toBe(true);
  });
  it('equal operation count with a different price blocks completion without discarding the prior selection', async () => {
    const s = setup(); s.args.publish = false;
    const first = await s.run();
    const selectedId = first.selected['acciones+cedears:GGAL'];
    s.clock.value = '2026-09-15T22:35:00Z';
    s.byma.responses.acciones = [row('GGAL', 101, 'ARS', { trades: 10 })];
    const second = await s.run();
    expect(second.status).toBe('PARTIAL');
    expect(second.selected['acciones+cedears:GGAL']).toBe(selectedId);
    expect(second.rejected).toContainEqual({ key: 'acciones+cedears:GGAL', reason: 'TRADE_COUNT_PRICE_CONFLICT' });
    expect(second.reconciliationAnomalies).toContainEqual(expect.objectContaining({
      key: 'acciones+cedears:GGAL', type: 'TRADE_COUNT_PRICE_CONFLICT', tradeCount: 10,
    }));
    expect(await s.store.get(`portfolioDailySnapshots/${DATE}`)).toBeNull();
  });
  it('a newer invalid row cannot replace an eligible selection even with a greater count', async () => {
    const s = setup(); s.args.publish = false;
    const first = await s.run();
    const selectedId = first.selected['acciones+cedears:GGAL'];
    s.clock.value = '2026-09-15T22:35:00Z';
    s.byma.responses.acciones = [row('GGAL', 101, 'ARS', { trades: 11, settlPeriod: '0001' })];
    const second = await s.run();
    expect(second.status).toBe('COMPLETE');
    expect(second.selected['acciones+cedears:GGAL']).toBe(selectedId);
    expect((await s.repo.observations(DATE)).some((o) => o.tradeCount === 11 && o.reason === 'INVALID_IDENTITY')).toBe(true);
  });
  it('restart reconciles a higher persisted count, and publication uses that final selection', async () => {
    const s = setup(); s.args.publish = false;
    const first = await s.run();
    const firstId = first.selected['acciones+cedears:GGAL'];
    s.clock.value = '2026-09-15T22:35:00Z';
    s.byma.responses.acciones = [row('GGAL', 101, 'ARS', { trades: 11 })];
    let once = true;
    s.store.beforeCommit = async (writes) => {
      if (once && writes[0].data.stage === 'BUILD') {
        once = false; throw Object.assign(new Error('Crash before reconciled selection commit'), { httpStatus: 403 });
      }
    };
    await expect(s.run()).rejects.toThrow();
    const persisted = (await s.repo.observations(DATE)).find((o) => o.tradeCount === 11
      && o.providerSymbol === 'GGAL' && o.priceType === 'TRADE');
    expect(persisted).toBeTruthy();
    s.store.beforeCommit = null;
    s.args.repo = createRepository(s.store, () => s.clock.value);
    s.args.publish = true;
    s.byma.responses.acciones = [row('GGAL', 99, 'ARS', { trades: 9 })];
    const recovered = await s.run();
    expect(recovered.selected['acciones+cedears:GGAL']).toBe(persisted.id);
    expect(recovered.reconciliation['acciones+cedears:GGAL'].lastSelectionChange).toMatchObject({
      fromObservationId: firstId, toObservationId: persisted.id, reason: 'MORE_TRADES',
    });
    const snapshot = (await s.store.get(`portfolioDailySnapshots/${DATE}`)).data;
    expect(snapshot.priceObservations).toContainEqual(expect.objectContaining({
      key: 'acciones+cedears:GGAL', observationId: persisted.id, tradeCount: 11,
    }));
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
  it.each(['b1-v1', 'b1-snapshot-last-trade-v2'])('old policy run %s cannot be silently reinterpreted', async (policyVersion) => {
    const s = setup();
    await s.store.commit([{ path: `marketPriceRuns/${DATE}`, data: { policyVersion } }]);
    await expect(s.run()).rejects.toMatchObject({ code: 'POLICY_VERSION_MISMATCH' });
    expect(s.byma.calls).toEqual([]);
  });
});
