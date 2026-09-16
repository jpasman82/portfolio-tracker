import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeFirestore = vi.hoisted(() => ({
  documents: new Map(),
  nextId: 1,
  batchCommits: [],
  transactionQueue: Promise.resolve(),
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
    runTransaction: (_db, callback) => {
      const execute = async () => {
        const writes = [];
        const transaction = {
          get: async (ref) => snapshot(ref),
          set: (ref, data) => writes.push({ type: 'set', ref, data }),
          update: (ref, data) => writes.push({ type: 'update', ref, data }),
        };
        const result = await callback(transaction);
        writes.forEach(({ type, ref, data }) => {
          fakeFirestore.documents.set(
            ref.path,
            type === 'update' ? { ...fakeFirestore.documents.get(ref.path), ...data } : data,
          );
        });
        fakeFirestore.batchCommits.push(writes.map(({ ref }) => ref.path));
        return result;
      };
      const pending = fakeFirestore.transactionQueue.then(execute, execute);
      fakeFirestore.transactionQueue = pending.catch(() => {});
      return pending;
    },
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
  fakeFirestore.transactionQueue = Promise.resolve();
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

describe('audited loan terms repository orchestration', () => {
  it('previews without writes and applies the exact same L1-backed correction atomically', async () => {
    const repository = createLoanRepository(db);
    const { assetId } = await repository.createLoan(uid, loan, '710000');
    const request = {
      kind: 'correction',
      changes: { rate: '0.01', name: 'Reclus corregido' },
      asOfDate: '2027-03-01',
    };
    const commitsBeforePreview = fakeFirestore.batchCommits.length;
    const preview = await repository.previewLoanTermsChange(uid, assetId, request);
    expect(fakeFirestore.batchCommits).toHaveLength(commitsBeforePreview);
    expect(await repository.listTermsChanges(uid, assetId)).toHaveLength(0);
    expect(await repository.getLoan(uid, assetId)).toMatchObject({ rate: '0.0125', revision: 0 });

    const applied = await repository.applyLoanTermsChange(uid, assetId, {
      ...request,
      reason: 'Tasa y nombre cargados incorrectamente',
      expectedRevision: preview.revision,
    });
    const restored = await repository.getLoan(uid, assetId);
    const audits = await repository.listTermsChanges(uid, assetId);

    expect(applied.currentValue).toEqual(preview.currentValue);
    expect(applied.proposedValue).toEqual(preview.proposedValue);
    expect(applied.proposedProjection).toEqual(preview.proposedProjection);
    expect(restored).toMatchObject({ name: 'Reclus corregido', rate: '0.01', revision: 1 });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      id: applied.changeId,
      kind: 'correction',
      reason: 'Tasa y nombre cargados incorrectamente',
      fromRevision: 0,
      toRevision: 1,
      before: preview.currentTerms,
      after: preview.proposedTerms,
    });
    expect(fakeFirestore.batchCommits.at(-1)).toEqual([
      `users/${uid}/nonBrokerAssets/${assetId}/termsChanges/${applied.changeId}`,
      `users/${uid}/nonBrokerAssets/${assetId}`,
    ]);
  });

  it('is atomic when reason validation fails', async () => {
    const repository = createLoanRepository(db);
    const { assetId } = await repository.createLoan(uid, loan, '710000');
    const commitsBefore = fakeFirestore.batchCommits.length;
    await expect(repository.applyLoanTermsChange(uid, assetId, {
      kind: 'correction',
      changes: { rate: '0.01' },
      asOfDate: '2027-03-01',
      reason: ' ',
      expectedRevision: 0,
    })).rejects.toMatchObject({ code: 'INVALID_REASON' });
    expect(fakeFirestore.batchCommits).toHaveLength(commitsBefore);
    expect(await repository.getLoan(uid, assetId)).toMatchObject({ rate: '0.0125', revision: 0 });
    expect(await repository.listTermsChanges(uid, assetId)).toHaveLength(0);
  });

  it('allows only one of two terms writers using the same revision', async () => {
    const repository = createLoanRepository(db);
    const { assetId } = await repository.createLoan(uid, loan, '710000');
    const base = {
      kind: 'correction',
      asOfDate: '2027-03-01',
      reason: 'Corrección concurrente',
      expectedRevision: 0,
    };
    const results = await Promise.allSettled([
      repository.applyLoanTermsChange(uid, assetId, { ...base, changes: { rate: '0.01' } }),
      repository.applyLoanTermsChange(uid, assetId, { ...base, changes: { rate: '0.02' } }),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected').reason)
      .toMatchObject({ code: 'STALE_LOAN_TERMS_REVISION' });
    expect(await repository.listTermsChanges(uid, assetId)).toHaveLength(1);
    expect(await repository.getLoan(uid, assetId)).toMatchObject({ revision: 1 });
  });

  it('extends maturity without writing any movement', async () => {
    const repository = createLoanRepository(db);
    const { assetId } = await repository.createLoan(uid, loan, '710000');
    const before = await repository.listMovements(uid, assetId);
    const applied = await repository.applyLoanTermsChange(uid, assetId, {
      kind: 'maturity_extension',
      changes: { maturityDate: '2028-09-01' },
      asOfDate: '2027-10-01',
      reason: 'Prórroga acordada',
      expectedRevision: 0,
    });
    expect(applied.continuesAccrualAfterOriginalMaturity).toBe(true);
    expect(await repository.listMovements(uid, assetId)).toEqual(before);
  });

  it('moves the initial contribution forward and then applies an audited startDate correction', async () => {
    const repository = createLoanRepository(db);
    const { assetId, movementId } = await repository.createLoan(uid, loan, '710000');
    await repository.correctMovement(uid, assetId, movementId, {
      type: 'contribution', effectiveDate: '2026-09-15', amount: '710000',
    });

    const request = {
      kind: 'correction',
      changes: { startDate: '2026-09-15' },
      asOfDate: '2026-09-16',
    };
    const preview = await repository.previewLoanTermsChange(uid, assetId, request);
    const applied = await repository.applyLoanTermsChange(uid, assetId, {
      ...request,
      reason: 'La fecha contractual original era incorrecta',
      expectedRevision: preview.revision,
    });

    expect(applied.proposedValue).toEqual(preview.proposedValue);
    expect(await repository.getLoan(uid, assetId)).toMatchObject({
      startDate: '2026-09-15', revision: 1,
    });
    expect(await repository.listTermsChanges(uid, assetId)).toEqual([
      expect.objectContaining({
        before: expect.objectContaining({ startDate: '2026-09-01' }),
        after: expect.objectContaining({ startDate: '2026-09-15' }),
        fromRevision: 0,
        toRevision: 1,
      }),
    ]);
  });
});

describe('auditable movement deletion repository orchestration', () => {
  it('appends one deterministic reversal and never mutates the original', async () => {
    const repository = createLoanRepository(db);
    const { assetId } = await repository.createLoan(uid, loan, '710000');
    const movementId = await repository.addMovement(uid, assetId, {
      type: 'contribution', effectiveDate: '2026-10-01', amount: '1000',
    });
    const originalBefore = fakeFirestore.documents.get(
      `users/${uid}/nonBrokerAssets/${assetId}/movements/${movementId}`,
    );

    const result = await repository.deleteMovement(uid, assetId, movementId, 'Carga duplicada');
    const movements = await repository.listMovements(uid, assetId);

    expect(result.reversalMovementId).toBe(`void-${movementId}`);
    expect(fakeFirestore.documents.get(
      `users/${uid}/nonBrokerAssets/${assetId}/movements/${movementId}`,
    )).toEqual(originalBefore);
    expect(movements.find(({ id }) => id === result.reversalMovementId)).toMatchObject({
      type: 'withdrawal',
      effectiveDate: '2026-10-01',
      amount: '1000',
      note: 'Carga duplicada',
      reversesMovementId: movementId,
    });
  });

  it('rejects deleting a contribution required by a later withdrawal without writing', async () => {
    const repository = createLoanRepository(db);
    const { assetId } = await repository.createLoan(uid, loan, '710000');
    const contributionId = await repository.addMovement(uid, assetId, {
      type: 'contribution', effectiveDate: '2026-10-01', amount: '100000',
    });
    await repository.addMovement(uid, assetId, {
      type: 'withdrawal', effectiveDate: '2026-10-02', amount: '800000',
    });
    const before = await repository.listMovements(uid, assetId);

    await expect(repository.deleteMovement(uid, assetId, contributionId, 'Duplicado'))
      .rejects.toMatchObject({ code: 'WITHDRAWAL_EXCEEDS_AVAILABLE_VALUE' });
    expect(await repository.listMovements(uid, assetId)).toEqual(before);
  });

  it('rejects deletion of the only initial contribution', async () => {
    const repository = createLoanRepository(db);
    const { assetId, movementId } = await repository.createLoan(uid, loan, '710000');
    await expect(repository.deleteMovement(uid, assetId, movementId, 'Alta equivocada'))
      .rejects.toMatchObject({ code: 'CONTRIBUTION_REQUIRED' });
  });

  it('deletes the first contribution when a later contribution remains', async () => {
    const repository = createLoanRepository(db);
    const { assetId, movementId } = await repository.createLoan(uid, loan, '710000');
    await repository.addMovement(uid, assetId, {
      type: 'contribution', effectiveDate: '2026-09-15', amount: '1000',
    });
    await expect(repository.deleteMovement(uid, assetId, movementId, 'Alta equivocada'))
      .resolves.toEqual({ reversalMovementId: `void-${movementId}` });
  });

  it('allows exactly one of two concurrent deletes of the same movement', async () => {
    const repository = createLoanRepository(db);
    const { assetId } = await repository.createLoan(uid, loan, '710000');
    const movementId = await repository.addMovement(uid, assetId, {
      type: 'contribution', effectiveDate: '2026-10-01', amount: '1000',
    });
    const results = await Promise.allSettled([
      repository.deleteMovement(uid, assetId, movementId, 'Duplicado'),
      repository.deleteMovement(uid, assetId, movementId, 'Duplicado'),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected').reason)
      .toMatchObject({ code: 'MOVEMENT_ALREADY_REVERSED' });
  });

  it('requires a reason before opening a transaction', async () => {
    const repository = createLoanRepository(db);
    const { assetId } = await repository.createLoan(uid, loan, '710000');
    const movementId = await repository.addMovement(uid, assetId, {
      type: 'withdrawal', effectiveDate: '2026-10-01', amount: '1000',
    });
    const commitsBefore = fakeFirestore.batchCommits.length;
    await expect(repository.deleteMovement(uid, assetId, movementId, ' '))
      .rejects.toMatchObject({ code: 'DELETE_REASON_REQUIRED' });
    expect(fakeFirestore.batchCommits).toHaveLength(commitsBefore);
  });
});
