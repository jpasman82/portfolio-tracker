import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRepository, createRestStore } from '../../server/closing/repository.js';
import { runClose } from '../../server/closing/pipeline.js';
import { fixtureByma, row, position, DATE, NOW } from '../../server/closing/testSupport.js';

const PROJECT = 'demo-b1-close';
let environment;
let store;
beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) throw new Error('Local Firestore emulator required; production forbidden');
  environment = await initializeTestEnvironment({ projectId: PROJECT,
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') } });
  store = createRestStore({ projectId: PROJECT, emulatorHost: host, getToken: async () => 'owner' });
});
beforeEach(async () => { await environment.clearFirestore(); });
afterAll(async () => { await environment?.cleanup(); });

describe('B1 real Firestore REST/CAS and rules (emulator only)', () => {
  it('real durable NO_TRADE remains PARTIAL and retry publishes only after the missing trade arrives', async () => {
    const repo = createRepository(store, () => NOW);
    const byma = fixtureByma();
    byma.responses.acciones = [row('GGAL', 0, 'ARS', { previous_close: 999 })];
    const args = { date: DATE, repo, byma, loadPositions: async () => [position('GGAL', -1)], publish: true, now: () => NOW, log: () => {} };
    const first = await runClose(args);
    expect(first.status).toBe('PARTIAL');
    expect(first.rejected).toContainEqual({ key: 'acciones+cedears:GGAL', reason: 'NO_TRADE' });
    expect(await store.get(`portfolioDailySnapshots/${DATE}`)).toBeNull();
    byma.responses.acciones = [row('GGAL', 100)];
    const second = await runClose({ ...args, repo: createRepository(store, () => NOW), loadPositions: () => { throw new Error('must use frozen'); } });
    expect(second.status).toBe('COMPLETE'); expect(second.selected).toMatchObject(first.selected);
    expect((await store.get(`portfolioDailySnapshots/${DATE}`)).data.pricePolicy).toBe('BYMA_SNAPSHOT_LAST_TRADE');
  });
  it('two full workers produce one publication and the competing lease fails closed', async () => {
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    const args = { date: DATE, repo: createRepository(store, () => NOW), byma: fixtureByma(),
      loadPositions: async () => { entered(); await hold; return [position()]; }, publish: true, now: () => NOW, log: () => {} };
    const worker = runClose({ ...args, attemptId: 'worker-one' });
    await started;
    try {
      await expect(runClose({ ...args, attemptId: 'worker-two' })).rejects.toMatchObject({ code: 'LEASE_BUSY' });
    } finally { release(); }
    expect((await worker).status).toBe('COMPLETE');
    expect(await store.list('portfolioDailySnapshots')).toHaveLength(1);
  });
  it('two workers cannot race a higher-count reconciliation and publication uses the winner selection', async () => {
    const firstRepo = createRepository(store, () => NOW);
    const first = await runClose({ date: DATE, repo: firstRepo, byma: fixtureByma(),
      loadPositions: async () => [position()], publish: false, now: () => NOW, log: () => {} });
    const firstId = first.selected['acciones+cedears:GGAL'];
    const later = '2026-09-15T22:35:00.000Z';
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    const byma = fixtureByma({ acciones: async () => {
      entered(); await hold;
      return { result: [row('GGAL', 101, 'ARS', { trades: 11 })] };
    } });
    const args = { date: DATE, repo: createRepository(store, () => later), byma,
      loadPositions: () => { throw new Error('must use frozen inputs'); }, publish: true,
      now: () => later, log: () => {} };
    const worker = runClose({ ...args, attemptId: 'reconcile-one' });
    await started;
    try {
      await expect(runClose({ ...args, attemptId: 'reconcile-two' })).rejects.toMatchObject({ code: 'LEASE_BUSY' });
    } finally { release(); }
    const result = await worker;
    const selectedId = result.selected['acciones+cedears:GGAL'];
    expect(selectedId).not.toBe(firstId);
    expect(result.reconciliation['acciones+cedears:GGAL']).toMatchObject({
      selectedObservationId: selectedId, selectedTradeCount: 11, lastOutcome: 'UPDATED_MORE_TRADES',
    });
    const snapshot = (await store.get(`portfolioDailySnapshots/${DATE}`)).data;
    expect(snapshot.priceObservations).toContainEqual(expect.objectContaining({
      key: 'acciones+cedears:GGAL', observationId: selectedId, tradeCount: 11,
    }));
    expect((await firstRepo.observations(DATE)).filter((o) => o.providerSymbol === 'GGAL'
      && o.priceType === 'TRADE')).toHaveLength(2);
  });
  it('server publishes atomically through the production REST adapter', async () => {
    const repo = createRepository(store, () => NOW);
    const state = await runClose({ date: DATE, repo, byma: fixtureByma(), loadPositions: async () => [position()],
      publish: true, now: () => NOW, log: () => {} });
    expect(state.status).toBe('COMPLETE');
    expect((await store.get(`portfolioDailySnapshots/${DATE}`)).data.b1BuildId).toBe(state.b1BuildId);
    expect((await repo.observations(DATE)).length).toBeGreaterThan(0);
  });
  it('actual concurrent CAS acquisition has one winner and fences the old worker', async () => {
    let clock = NOW;
    const repo = createRepository(store, () => clock);
    const results = await Promise.allSettled([repo.acquire(DATE, 'a'), repo.acquire(DATE, 'b')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const old = results.find((r) => r.status === 'fulfilled').value.lease;
    clock = '2026-09-15T22:02:00.000Z';
    await repo.acquire(DATE, 'new');
    await expect(repo.publish(DATE, old, { b1BuildId: 'bad' }, {})).rejects.toMatchObject({ code: 'LEASE_LOST' });
    expect(await store.get(`portfolioDailySnapshots/${DATE}`)).toBeNull();
  });
  it('failed precondition on snapshot rolls back the entire atomic commit', async () => {
    await store.commit([{ path: `portfolioDailySnapshots/${DATE}`, data: { source: 'manual' } }]);
    await expect(store.commit([
      { path: `marketPriceRuns/${DATE}`, data: { status: 'COMPLETE' } },
      { path: `portfolioDailySnapshots/${DATE}`, data: { source: 'b1' } },
    ])).rejects.toThrow();
    expect(await store.get(`marketPriceRuns/${DATE}`)).toBeNull();
    expect((await store.get(`portfolioDailySnapshots/${DATE}`)).data.source).toBe('manual');
  });
  it('normal authenticated and anonymous clients cannot read or mutate internal runs/observations/inputs', async () => {
    for (const context of [environment.authenticatedContext('ordinary'), environment.unauthenticatedContext()]) {
      const db = context.firestore();
      for (const path of [`marketPriceRuns/${DATE}`, `marketPriceRuns/${DATE}/observations/a`, `marketPriceRuns/${DATE}/inputs/frozen`]) {
        const ref = doc(db, path);
        await assertFails(setDoc(ref, { status: 'COMPLETE' }));
        await assertFails(getDoc(ref));
        await assertFails(deleteDoc(ref));
      }
    }
  });
  it('legacy authenticated frontend history and positions permissions remain unchanged', async () => {
    const db = environment.authenticatedContext('ordinary').firestore();
    await assertSucceeds(setDoc(doc(db, 'brokerPositions/one'), { assets: [] }));
    await assertSucceeds(setDoc(doc(db, `portfolioDailySnapshots/${DATE}`), { source: 'manual' }));
    await assertSucceeds(getDoc(doc(db, `portfolioDailySnapshots/${DATE}`)));
  });
});
