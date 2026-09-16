import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeFirestore = vi.hoisted(() => ({
  documents: new Map(),
  writes: [],
  failManualReads: false,
}));

vi.mock('../firebase/config', () => ({ db: Object.freeze({ path: '' }) }));
vi.mock('firebase/firestore', () => {
  const reference = (path) => ({ path, id: path.split('/').at(-1) });
  const childPath = (parent, segments) => [parent?.path, ...segments].filter(Boolean).join('/');
  return {
    collection: (parent, ...segments) => reference(childPath(parent, segments)),
    doc: (parent, ...segments) => reference(childPath(parent, segments)),
    getDocs: async (ref) => {
      if (fakeFirestore.failManualReads && ref.path === 'portfolioManualBaselines') {
        throw new Error('permission denied');
      }
      const prefix = `${ref.path}/`;
      const docs = [...fakeFirestore.documents.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, data]) => ({ id: path.slice(prefix.length), data: () => data }));
      return { docs };
    },
    orderBy: () => ({}),
    query: (ref) => ref,
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    setDoc: async (ref, data) => {
      fakeFirestore.writes.push({ path: ref.path, data });
      fakeFirestore.documents.set(ref.path, data);
    },
  };
});

import { fetchPortfolioSnapshots, saveManualPortfolioSnapshot } from './portfolioSnapshots';

beforeEach(() => {
  fakeFirestore.documents.clear();
  fakeFirestore.writes = [];
  fakeFirestore.failManualReads = false;
});

describe('portfolio history writer isolation', () => {
  it('stores a manual reference only in its separate baseline collection', async () => {
    await saveManualPortfolioSnapshot({ date: '2026-09-15', netUsd: 100, mepRate: 2 });
    expect(fakeFirestore.writes).toHaveLength(1);
    expect(fakeFirestore.writes[0]).toMatchObject({
      path: 'portfolioManualBaselines/2026-09-15',
      data: { date: '2026-09-15', source: 'manual-baseline' },
    });
    expect(fakeFirestore.writes[0].path).not.toContain('portfolioDailySnapshots');
  });

  it('reads official and manual history while preferring official data for the same date', async () => {
    fakeFirestore.documents.set('portfolioManualBaselines/2026-09-14', { date: '2026-09-14', totals: { usd: 10 } });
    fakeFirestore.documents.set('portfolioManualBaselines/2026-09-15', { date: '2026-09-15', totals: { usd: 20 } });
    fakeFirestore.documents.set('portfolioDailySnapshots/2026-09-15', { date: '2026-09-15', totals: { usd: 30 } });

    await expect(fetchPortfolioSnapshots()).resolves.toEqual([
      expect.objectContaining({ id: 'manual:2026-09-14', historyType: 'manual-baseline', date: '2026-09-14' }),
      expect.objectContaining({ id: 'official:2026-09-15', historyType: 'official', date: '2026-09-15', totals: { usd: 30 } }),
    ]);
  });

  it('keeps official history readable while manual-baseline rules are still pending', async () => {
    fakeFirestore.documents.set('portfolioDailySnapshots/2026-09-15', { date: '2026-09-15', totals: { usd: 30 } });
    fakeFirestore.failManualReads = true;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(fetchPortfolioSnapshots()).resolves.toEqual([
      expect.objectContaining({ id: 'official:2026-09-15', historyType: 'official' }),
    ]);
    expect(warning).toHaveBeenCalledWith(
      '[portfolioSnapshots] Manual baselines unavailable:', 'permission denied',
    );
    warning.mockRestore();
  });

  it('contains no client API that can write the official daily collection', () => {
    const sources = [
      new URL('./portfolioSnapshots.js', import.meta.url),
      new URL('../pages/Home.jsx', import.meta.url),
      new URL('../pages/PortfolioHistory.jsx', import.meta.url),
    ].map((url) => readFileSync(fileURLToPath(url), 'utf8'));
    expect(sources.join('\n')).not.toContain('saveDailyPortfolioSnapshot');
    expect(sources[0]).not.toMatch(/setDoc\(doc\(db,\s*SNAPSHOT_COLLECTION/);
  });
});
