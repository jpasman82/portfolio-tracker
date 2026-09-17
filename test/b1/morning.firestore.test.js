import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMorning } from '../../server/closing/morning.js';
import { createRestStore } from '../../server/closing/repository.js';

const PROJECT = 'demo-b1-morning';
const INFORMATION_DATE = '2026-09-17';
const NOW = '2026-09-17T13:20:00.000Z';
const spec = {
  acciones: { currency: 'ARS', category: 1 },
  cedears: { currency: 'ARS', category: 23 },
  bonosARS: { currency: 'ARS', category: 3 },
  bonosUSD: { currency: 'USD', category: 3 },
  bonosEXT: { currency: 'EXT', category: 3 },
};
const row = (group, symbol, previousClose) => {
  const { currency, category } = spec[group];
  return { symbol, security_id: `${symbol}-0002-C-CT-${currency}`, currency, category,
    market: 'CT', settlPeriod: '0002', operativeForm: 'C', previous_close: previousClose,
    trade: 999999, closing_price: 999999, trades: 999, Date: INFORMATION_DATE };
};
const responseData = () => ({
  acciones: { result: [row('acciones', 'GGAL', 100)] },
  cedears: { result: [row('cedears', 'AAPL', 200)] },
  bonosARS: { result: [row('bonosARS', 'AL30', 1200)] },
  bonosUSD: { result: [row('bonosUSD', 'AL30D', 1.2)] },
  bonosEXT: { result: [row('bonosEXT', 'AL30C', 1.1)] },
});
const positions = [{ id: 'broker-one', updateTime: 'v1', data: {
  assets: [{ ticker: 'GGAL', quantity: 2, price: 123456 }], debt: 0,
} }];

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

const execute = (source = responseData()) => runMorning({
  informationDate: INFORMATION_DATE,
  store,
  byma: { fetchGroup: async (group) => structuredClone(source[group]) },
  loadPositions: async () => structuredClone(positions),
  now: () => NOW,
  log: () => {},
});

describe('morning previous-close Firestore create-only publication', () => {
  it('creates one complete server-owned snapshot and a repeat is a no-op', async () => {
    expect((await execute()).publicationStatus).toBe('PUBLISHED');
    expect((await execute()).publicationStatus).toBe('NOOP');
    const snapshots = await store.list('portfolioDailySnapshots');
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].data).toMatchObject({ valuationDate: '2026-09-16', informationDate: '2026-09-17',
      pricePolicy: 'BYMA_SNAPSHOT_PREVIOUS_CLOSE', valuationScope: 'BROKERS_ONLY' });
    expect(await store.list('marketPriceRuns')).toEqual([]);
    expect(await store.list('brokerPositions')).toEqual([]);
  });

  it('preserves an incompatible existing document without overwrite', async () => {
    await store.commit([{ path: 'portfolioDailySnapshots/2026-09-16', data: { source: 'manual' } }]);
    await expect(execute()).rejects.toMatchObject({ code: 'EXISTING_SNAPSHOT_CONFLICT' });
    expect((await store.get('portfolioDailySnapshots/2026-09-16')).data).toEqual({ source: 'manual' });
  });

  it('keeps official snapshots server-only for authenticated clients', async () => {
    const client = environment.authenticatedContext('user-one').firestore();
    await assertFails(setDoc(doc(client, 'portfolioDailySnapshots', '2026-09-16'), { source: 'client' }));
  });
});
