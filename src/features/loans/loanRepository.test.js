import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeFirestore = vi.hoisted(() => ({
  documents: new Map(),
  nextId: 1,
  batchCommits: [],
}));

vi.mock('firebase/firestore', () => {
  const reference = (path) => ({ path, id: path.split('/').at(-1) });
  const childPath = (parent, segments) => [parent?.path, ...segments].filter(Boolean).join('/');
  const snapshot = (ref) => ({
    id: ref.id,
    exists: () => fakeFirestore.documents.has(ref.path),
    data: () => fakeFirestore.documents.get(ref.path),
  });

  return {
    collection: (parent, ...segments) => reference(childPath(parent, segments)),
    doc: (parent, ...segments) => {
      if (segments.length === 0) {
        const id = `generated-${fakeFirestore.nextId++}`;
        return reference(childPath(parent, [id]));
      }
      return reference(childPath(parent, segments));
    },
    getDoc: async (ref) => snapshot(ref),
    getDocs: async (ref) => {
      const prefix = `${ref.path}/`;
      const docs = [...fakeFirestore.documents.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path]) => snapshot(reference(path)));
      return { docs };
    },
    orderBy: () => ({}),
    query: (ref) => ref,
    serverTimestamp: () => ({ toDate: () => new Date('2026-09-01T00:00:00.000Z') }),
    setDoc: async (ref, data) => fakeFirestore.documents.set(ref.path, data),
    updateDoc: async (ref, changes) => {
      fakeFirestore.documents.set(ref.path, { ...fakeFirestore.documents.get(ref.path), ...changes });
    },
    writeBatch: () => {
      const writes = [];
      return {
        set: (ref, data) => writes.push({ ref, data }),
        commit: async () => {
          writes.forEach(({ ref, data }) => fakeFirestore.documents.set(ref.path, data));
          fakeFirestore.batchCommits.push(writes.map(({ ref }) => ref.path));
        },
      };
    },
  };
});

import { createLoanRepository } from './loanRepository';

const db = Object.freeze({ path: '' });
const uid = 'user-123';
const loan = Object.freeze({
  type: 'loan',
  name: 'Fixture',
  currency: 'USD',
  startDate: '2026-09-01',
  maturityDate: '2027-09-01',
  rate: '0.0125',
  rateType: 'monthly_effective',
  capitalizationFrequency: 'monthly',
  calculationVersion: 'loan-v1',
  status: 'active',
});

beforeEach(() => {
  fakeFirestore.documents.clear();
  fakeFirestore.nextId = 1;
  fakeFirestore.batchCommits = [];
});

describe('loan movement repository orchestration', () => {
  it('adds contributions and withdrawals after validating the resulting complete ledger', async () => {
    const repository = createLoanRepository(db);
    const { assetId } = await repository.createLoan(uid, loan, '710000');
    await repository.addMovement(uid, assetId, {
      type: 'contribution', effectiveDate: '2026-10-10', amount: '1000',
    });
    await repository.addMovement(uid, assetId, {
      type: 'withdrawal', effectiveDate: '2026-10-11', amount: '500',
    });

    const movements = await repository.listMovements(uid, assetId);
    expect(movements).toHaveLength(3);
    expect(movements.map((movement) => movement.type)).toEqual([
      'contribution', 'contribution', 'withdrawal',
    ]);
  });

  it('does not persist a backdated movement that invalidates a later withdrawal', async () => {
    const repository = createLoanRepository(db);
    const { assetId } = await repository.createLoan(uid, loan, '710000');
    await repository.addMovement(uid, assetId, {
      type: 'withdrawal', effectiveDate: '2026-12-01', amount: '500000',
    });

    await expect(repository.addMovement(uid, assetId, {
      type: 'withdrawal', effectiveDate: '2026-10-15', amount: '300000',
    })).rejects.toMatchObject({ code: 'WITHDRAWAL_EXCEEDS_AVAILABLE_VALUE' });
    expect(await repository.listMovements(uid, assetId)).toHaveLength(2);
  });

  it('commits reversal and replacement together without mutating the original', async () => {
    const repository = createLoanRepository(db);
    const { assetId } = await repository.createLoan(uid, loan, '710000');
    const originalMovementId = await repository.addMovement(uid, assetId, {
      type: 'contribution', effectiveDate: '2026-10-15', amount: '100000', note: 'Original',
    });
    const commitsBeforeCorrection = fakeFirestore.batchCommits.length;

    const corrected = await repository.correctMovement(uid, assetId, originalMovementId, {
      type: 'contribution', effectiveDate: '2026-10-16', amount: '80000', note: 'Corregido',
    });
    const correctionCommit = fakeFirestore.batchCommits.at(-1);
    const movements = await repository.listMovements(uid, assetId);

    expect(fakeFirestore.batchCommits).toHaveLength(commitsBeforeCorrection + 1);
    expect(correctionCommit).toHaveLength(2);
    expect(movements.find((movement) => movement.id === originalMovementId))
      .toMatchObject({ amount: '100000', effectiveDate: '2026-10-15', note: 'Original' });
    expect(movements.find((movement) => movement.id === corrected.reversalMovementId))
      .toMatchObject({ amount: '100000', effectiveDate: '2026-10-15', reversesMovementId: originalMovementId });
    expect(movements.find((movement) => movement.id === corrected.replacementMovementId))
      .toMatchObject({ amount: '80000', effectiveDate: '2026-10-16', note: 'Corregido' });
  });

  it('performs no correction batch when the resulting ledger is invalid', async () => {
    const repository = createLoanRepository(db);
    const { assetId } = await repository.createLoan(uid, loan, '710000');
    const originalMovementId = await repository.addMovement(uid, assetId, {
      type: 'contribution', effectiveDate: '2026-10-15', amount: '1000',
    });
    const commitsBeforeCorrection = fakeFirestore.batchCommits.length;

    await expect(repository.correctMovement(uid, assetId, originalMovementId, {
      type: 'withdrawal', effectiveDate: '2026-10-15', amount: '800000',
    })).rejects.toMatchObject({ code: 'WITHDRAWAL_EXCEEDS_AVAILABLE_VALUE' });
    expect(fakeFirestore.batchCommits).toHaveLength(commitsBeforeCorrection);
    expect(await repository.listMovements(uid, assetId)).toHaveLength(2);
  });
});
