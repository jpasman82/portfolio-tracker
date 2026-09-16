import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { calculateLoanAtDate } from '../../src/features/loans/loanEngine';
import { createLoanRepository } from '../../src/features/loans/loanRepository';
import {
  toLoanEngineDefinition,
  toLoanEngineMovement,
} from '../../src/features/loans/loanSerialization';

const PROJECT_ID = 'demo-loan-persistence';
const USER_A = 'user-a';
const USER_B = 'user-b';
const rulesPath = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
let testEnvironment;

function authenticatedDb(uid) {
  return testEnvironment.authenticatedContext(uid).firestore();
}

function anonymousDb() {
  return testEnvironment.unauthenticatedContext().firestore();
}

function loanData(overrides = {}) {
  return {
    type: 'loan',
    name: 'Reclus',
    currency: 'USD',
    startDate: '2026-09-01',
    maturityDate: '2027-09-01',
    rate: '0.0125',
    rateType: 'monthly_effective',
    capitalizationFrequency: 'monthly',
    calculationVersion: 'loan-v1',
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function loanInput(overrides = {}) {
  const data = loanData(overrides);
  delete data.createdAt;
  delete data.updatedAt;
  return data;
}

function movementData(overrides = {}) {
  return {
    type: 'contribution',
    effectiveDate: '2026-09-01',
    amount: '710000',
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function loanRef(db, uid, assetId = 'loan-1') {
  return doc(db, 'users', uid, 'nonBrokerAssets', assetId);
}

function movementRef(db, uid, assetId = 'loan-1', movementId = 'movement-1') {
  return doc(db, 'users', uid, 'nonBrokerAssets', assetId, 'movements', movementId);
}

async function seedLoan(uid, assetId = 'loan-1', overrides = {}) {
  const db = authenticatedDb(uid);
  await assertSucceeds(setDoc(loanRef(db, uid, assetId), loanData(overrides)));
  return db;
}

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(rulesPath, 'utf8') },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
});

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe('security baseline compatibility and deny-by-default', () => {
  it.each(['brokerPositions', 'rotations'])(
    'preserves authenticated shared access to %s',
    async (path) => {
      const db = authenticatedDb(USER_A);
      const reference = doc(db, path, 'legacy-document');
      await assertSucceeds(setDoc(reference, { legacy: true }));
      await assertSucceeds(getDoc(reference));
    },
  );

  it('preserves authenticated read access but blocks client writes to official daily snapshots', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'portfolioDailySnapshots', '2026-09-15'), { source: 'b1' });
    });
    const db = authenticatedDb(USER_A);
    const reference = doc(db, 'portfolioDailySnapshots', '2026-09-15');
    await assertSucceeds(getDoc(reference));
    await assertFails(setDoc(reference, { source: 'manual' }));
  });

  it('rejects anonymous legacy and loan reads and writes', async () => {
    const db = anonymousDb();
    await assertFails(setDoc(doc(db, 'brokerPositions', 'position'), { value: 1 }));
    await assertFails(getDoc(doc(db, 'rotations', 'rotation')));
    await assertFails(setDoc(loanRef(db, USER_A), loanData()));
    await assertFails(getDoc(loanRef(db, USER_A)));
  });

  it('rejects authenticated access to an unknown path', async () => {
    const db = authenticatedDb(USER_A);
    await assertFails(setDoc(doc(db, 'unknownCollection', 'document'), { value: true }));
    await assertFails(getDoc(doc(db, 'unknownCollection', 'document')));
  });
});

describe('loan ownership, schema, and immutable contract', () => {
  it('lets an owner create, read, list, rename, and close a valid loan', async () => {
    const db = authenticatedDb(USER_A);
    const reference = loanRef(db, USER_A);

    await assertSucceeds(setDoc(reference, loanData()));
    await assertSucceeds(getDoc(reference));
    await assertSucceeds(getDocs(collection(db, 'users', USER_A, 'nonBrokerAssets')));
    await assertSucceeds(updateDoc(reference, { name: 'Reclus actualizado', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(reference, { status: 'closed', updatedAt: serverTimestamp() }));
  });

  it('isolates both documents and namespace queries by Firebase UID', async () => {
    await seedLoan(USER_B);
    const dbA = authenticatedDb(USER_A);

    await assertFails(getDoc(loanRef(dbA, USER_B)));
    await assertFails(getDocs(collection(dbA, 'users', USER_B, 'nonBrokerAssets')));
    await assertFails(setDoc(loanRef(dbA, USER_B, 'foreign'), loanData()));

    await seedLoan(USER_A, 'owned-by-a');
    const dbB = authenticatedDb(USER_B);
    await assertFails(getDoc(loanRef(dbB, USER_A, 'owned-by-a')));
  });

  it.each(['0', '0.0125', '1000.50'])(
    'accepts canonical persisted rates: %s',
    async (rate) => {
      const db = authenticatedDb(USER_A);
      await assertSucceeds(setDoc(loanRef(db, USER_A, `rate-${rate.replace('.', '-')}`), loanData({ rate })));
    },
  );

  it.each([
    ['contract rate', { rate: '0.02', updatedAt: serverTimestamp() }],
    ['createdAt', { createdAt: Timestamp.fromMillis(0), updatedAt: serverTimestamp() }],
    ['arbitrary field', { arbitrary: true, updatedAt: serverTimestamp() }],
  ])('rejects updates to %s', async (_label, changes) => {
    const db = await seedLoan(USER_A);
    await assertFails(updateDoc(loanRef(db, USER_A), changes));
  });

  it.each([
    ['non-canonical rate', { rate: '01' }],
    ['negative rate', { rate: '-1' }],
    ['unknown field', { arbitrary: true }],
    ['initialAmount', { initialAmount: '710000' }],
    ['persisted matured status', { status: 'matured' }],
    ['inverted dates', { maturityDate: '2026-08-31' }],
    ['client createdAt', { createdAt: Timestamp.fromMillis(0) }],
  ])('rejects loan create with %s', async (_label, changes) => {
    const db = authenticatedDb(USER_A);
    await assertFails(setDoc(loanRef(db, USER_A), loanData(changes)));
  });

  it('only permits active status on create', async () => {
    const db = authenticatedDb(USER_A);
    await assertFails(setDoc(loanRef(db, USER_A), loanData({ status: 'closed' })));
    await assertFails(setDoc(loanRef(db, USER_A, 'cancelled'), loanData({ status: 'cancelled' })));
  });

  it.each(['closed', 'cancelled'])('makes %s terminal', async (terminalStatus) => {
    const db = await seedLoan(USER_A);
    const reference = loanRef(db, USER_A);
    await assertSucceeds(updateDoc(reference, { status: terminalStatus, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(reference, { status: 'active', updatedAt: serverTimestamp() }));
  });

  it('denies deletion of loan history', async () => {
    const db = await seedLoan(USER_A);
    await assertFails(deleteDoc(loanRef(db, USER_A)));
  });
});

describe('append-only movement policy', () => {
  it('accepts a valid movement with optional structural metadata', async () => {
    const db = await seedLoan(USER_A);
    await assertSucceeds(setDoc(movementRef(db, USER_A), movementData({
      note: 'Aporte inicial',
      reversesMovementId: 'prior-entry',
    })));
  });

  it.each(['710000', '1000.50', '0.01'])(
    'accepts canonical positive persisted amounts: %s',
    async (amount) => {
      const db = await seedLoan(USER_A);
      await assertSucceeds(setDoc(
        movementRef(db, USER_A, 'loan-1', `amount-${amount.replace('.', '-')}`),
        movementData({ amount }),
      ));
    },
  );

  it('accepts both contract date boundaries', async () => {
    const db = await seedLoan(USER_A);
    await assertSucceeds(setDoc(movementRef(db, USER_A, 'loan-1', 'start'), movementData()));
    await assertSucceeds(setDoc(
      movementRef(db, USER_A, 'loan-1', 'maturity'),
      movementData({ effectiveDate: '2027-09-01', amount: '1' }),
    ));
  });

  it.each([
    ['zero amount', { amount: '0' }],
    ['zero decimal amount', { amount: '0.00' }],
    ['non-canonical amount', { amount: '01' }],
    ['exponent amount', { amount: '1e3' }],
    ['unknown type', { type: 'interest' }],
    ['unknown field', { arbitrary: true }],
    ['before start', { effectiveDate: '2026-08-31' }],
    ['after maturity', { effectiveDate: '2027-09-02' }],
    ['client timestamp', { createdAt: Timestamp.fromMillis(0) }],
  ])('rejects %s', async (_label, changes) => {
    const db = await seedLoan(USER_A);
    await assertFails(setDoc(movementRef(db, USER_A), movementData(changes)));
  });

  it.each(['closed', 'cancelled'])('rejects movement creation for a %s parent', async (status) => {
    const db = await seedLoan(USER_A);
    await assertSucceeds(updateDoc(loanRef(db, USER_A), { status, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(movementRef(db, USER_A), movementData()));
  });

  it('rejects movement creation without a parent loan', async () => {
    const db = authenticatedDb(USER_A);
    await assertFails(setDoc(movementRef(db, USER_A), movementData()));
  });

  it('denies cross-user movement access', async () => {
    const dbB = await seedLoan(USER_B);
    await assertSucceeds(setDoc(movementRef(dbB, USER_B), movementData()));
    const dbA = authenticatedDb(USER_A);
    await assertFails(getDoc(movementRef(dbA, USER_B)));
    await assertFails(setDoc(movementRef(dbA, USER_B, 'loan-1', 'foreign'), movementData()));
  });

  it('denies movement updates and deletes', async () => {
    const db = await seedLoan(USER_A);
    const reference = movementRef(db, USER_A);
    await assertSucceeds(setDoc(reference, movementData()));
    await assertFails(updateDoc(reference, { note: 'Changed' }));
    await assertFails(deleteDoc(reference));
  });
});

describe('loan repository and Firestore-to-L1 roundtrip', () => {
  it('creates a loan and initial contribution atomically, then lists and reads both', async () => {
    const repository = createLoanRepository(authenticatedDb(USER_A));
    const identifiers = await repository.createLoan(USER_A, loanInput(), {
      amount: '710000',
      note: 'Desembolso inicial',
    });

    const loans = await repository.listLoans(USER_A);
    const restored = await repository.getLoan(USER_A, identifiers.assetId);
    const movements = await repository.listMovements(USER_A, identifiers.assetId);

    expect(loans).toHaveLength(1);
    expect(restored.rate).toBe('0.0125');
    expect(restored.startDate).toBe('2026-09-01');
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      id: identifiers.movementId,
      type: 'contribution',
      effectiveDate: '2026-09-01',
      amount: '710000',
      note: 'Desembolso inicial',
    });
  });

  it('never performs a query without an explicit valid UID', async () => {
    const repository = createLoanRepository(authenticatedDb(USER_A));
    await expect(repository.listLoans(null)).rejects.toThrow(/uid/);
    await expect(repository.getLoan(undefined, 'loan-1')).rejects.toThrow(/uid/);
    await expect(repository.listMovements('', 'loan-1')).rejects.toThrow(/uid/);
  });

  it('requires the initial contribution before creating either batch document', async () => {
    const repository = createLoanRepository(authenticatedDb(USER_A));
    await expect(repository.createLoan(USER_A, loanInput(), undefined))
      .rejects.toThrow(/initialContribution/);
    expect(await repository.listLoans(USER_A)).toHaveLength(0);
  });

  it('cannot use an authenticated A repository to access B', async () => {
    const repositoryB = createLoanRepository(authenticatedDb(USER_B));
    const { assetId } = await repositoryB.createLoan(USER_B, loanInput(), '710000');
    const repositoryA = createLoanRepository(authenticatedDb(USER_A));

    await expect(repositoryA.getLoan(USER_B, assetId)).rejects.toBeDefined();
    await expect(repositoryA.listLoans(USER_B)).rejects.toBeDefined();
  });

  it('sorts arbitrarily inserted movements by effectiveDate and feeds the real L1 engine', async () => {
    const repository = createLoanRepository(authenticatedDb(USER_A));
    const { assetId } = await repository.createLoan(USER_A, loanInput(), '710000');
    await repository.addMovement(USER_A, assetId, {
      type: 'contribution',
      effectiveDate: '2026-11-15',
      amount: '2000.50',
    });
    await repository.addMovement(USER_A, assetId, {
      type: 'withdrawal',
      effectiveDate: '2026-10-10',
      amount: '1000.50',
    });

    const restoredLoan = await repository.getLoan(USER_A, assetId);
    const restoredMovements = await repository.listMovements(USER_A, assetId);
    expect(restoredMovements.map((movement) => movement.effectiveDate)).toEqual([
      '2026-09-01',
      '2026-10-10',
      '2026-11-15',
    ]);
    expect(restoredMovements.map((movement) => movement.amount)).toEqual([
      '710000',
      '1000.50',
      '2000.50',
    ]);

    const result = calculateLoanAtDate({
      loan: toLoanEngineDefinition(restoredLoan),
      movements: restoredMovements.map(toLoanEngineMovement),
      asOfDate: '2027-09-01',
    });
    expect(result.value).not.toBe('0');
  });

  it('rejects a withdrawal above the effective-date value before writing it', async () => {
    const repository = createLoanRepository(authenticatedDb(USER_A));
    const { assetId } = await repository.createLoan(USER_A, loanInput(), '710000');

    await expect(repository.addMovement(USER_A, assetId, {
      type: 'withdrawal',
      effectiveDate: '2026-09-01',
      amount: '710000.01',
    })).rejects.toMatchObject({ code: 'WITHDRAWAL_EXCEEDS_AVAILABLE_VALUE' });
    expect(await repository.listMovements(USER_A, assetId)).toHaveLength(1);
  });

  it('rejects a backdated withdrawal that makes a later existing withdrawal insolvent', async () => {
    const repository = createLoanRepository(authenticatedDb(USER_A));
    const { assetId } = await repository.createLoan(USER_A, loanInput(), '710000');
    await repository.addMovement(USER_A, assetId, {
      type: 'withdrawal',
      effectiveDate: '2026-12-01',
      amount: '500000',
    });

    await expect(repository.addMovement(USER_A, assetId, {
      type: 'withdrawal',
      effectiveDate: '2026-10-15',
      amount: '300000',
    })).rejects.toMatchObject({ code: 'WITHDRAWAL_EXCEEDS_AVAILABLE_VALUE' });
    expect(await repository.listMovements(USER_A, assetId)).toHaveLength(2);
  });

  it('creates an append-only amount correction as exactly one reversal and one replacement', async () => {
    const repository = createLoanRepository(authenticatedDb(USER_A));
    const { assetId } = await repository.createLoan(USER_A, loanInput(), '710000');
    const originalMovementId = await repository.addMovement(USER_A, assetId, {
      type: 'contribution',
      effectiveDate: '2026-10-15',
      amount: '100000',
      note: 'Monto incorrecto',
    });

    const result = await repository.correctMovement(USER_A, assetId, originalMovementId, {
      type: 'contribution',
      effectiveDate: '2026-10-15',
      amount: '80000',
      note: 'Monto corregido',
    });
    const movements = await repository.listMovements(USER_A, assetId);
    const original = movements.find((movement) => movement.id === originalMovementId);
    const reversal = movements.find((movement) => movement.id === result.reversalMovementId);
    const replacement = movements.find((movement) => movement.id === result.replacementMovementId);

    expect(movements).toHaveLength(4);
    expect(original).toMatchObject({ amount: '100000', note: 'Monto incorrecto' });
    expect(reversal).toMatchObject({
      type: 'withdrawal',
      effectiveDate: '2026-10-15',
      amount: '100000',
      reversesMovementId: originalMovementId,
    });
    expect(replacement).toMatchObject({
      type: 'contribution',
      effectiveDate: '2026-10-15',
      amount: '80000',
      note: 'Monto corregido',
    });
    expect(replacement.reversesMovementId).toBeUndefined();
  });

  it('corrects date, type, and note without updating the original document', async () => {
    const repository = createLoanRepository(authenticatedDb(USER_A));
    const { assetId } = await repository.createLoan(USER_A, loanInput(), '710000');
    const originalMovementId = await repository.addMovement(USER_A, assetId, {
      type: 'contribution',
      effectiveDate: '2026-10-10',
      amount: '1000',
      note: 'Antes',
    });

    const result = await repository.correctMovement(USER_A, assetId, originalMovementId, {
      type: 'withdrawal',
      effectiveDate: '2026-10-15',
      amount: '900',
      note: 'Después',
    });
    const movements = await repository.listMovements(USER_A, assetId);
    const original = movements.find((movement) => movement.id === originalMovementId);
    const reversal = movements.find((movement) => movement.id === result.reversalMovementId);
    const replacement = movements.find((movement) => movement.id === result.replacementMovementId);

    expect(original).toMatchObject({
      type: 'contribution', effectiveDate: '2026-10-10', amount: '1000', note: 'Antes',
    });
    expect(reversal).toMatchObject({
      type: 'withdrawal', effectiveDate: '2026-10-10', amount: '1000',
      reversesMovementId: originalMovementId,
    });
    expect(replacement).toMatchObject({
      type: 'withdrawal', effectiveDate: '2026-10-15', amount: '900', note: 'Después',
    });
  });

  it('supports correcting a prior replacement while preserving the full chain', async () => {
    const repository = createLoanRepository(authenticatedDb(USER_A));
    const { assetId } = await repository.createLoan(USER_A, loanInput(), '710000');
    const originalMovementId = await repository.addMovement(USER_A, assetId, {
      type: 'contribution', effectiveDate: '2026-10-10', amount: '1000',
    });
    const first = await repository.correctMovement(USER_A, assetId, originalMovementId, {
      type: 'contribution', effectiveDate: '2026-10-11', amount: '900',
    });
    const second = await repository.correctMovement(USER_A, assetId, first.replacementMovementId, {
      type: 'contribution', effectiveDate: '2026-10-12', amount: '800',
    });
    const movements = await repository.listMovements(USER_A, assetId);

    expect(movements).toHaveLength(6);
    expect(movements.find((movement) => movement.id === second.reversalMovementId))
      .toMatchObject({ reversesMovementId: first.replacementMovementId });
    expect(movements.find((movement) => movement.id === second.replacementMovementId))
      .toMatchObject({ effectiveDate: '2026-10-12', amount: '800' });
  });

  it('rejects correcting an original that was already neutralized', async () => {
    const repository = createLoanRepository(authenticatedDb(USER_A));
    const { assetId } = await repository.createLoan(USER_A, loanInput(), '710000');
    const originalMovementId = await repository.addMovement(USER_A, assetId, {
      type: 'contribution', effectiveDate: '2026-10-10', amount: '1000',
    });
    await repository.correctMovement(USER_A, assetId, originalMovementId, {
      type: 'contribution', effectiveDate: '2026-10-10', amount: '900',
    });

    await expect(repository.correctMovement(USER_A, assetId, originalMovementId, {
      type: 'contribution', effectiveDate: '2026-10-10', amount: '800',
    })).rejects.toMatchObject({ code: 'MOVEMENT_ALREADY_REVERSED' });
  });

  it('rejects unknown and technical reversal edits without adding partial documents', async () => {
    const repository = createLoanRepository(authenticatedDb(USER_A));
    const { assetId } = await repository.createLoan(USER_A, loanInput(), '710000');
    await expect(repository.correctMovement(USER_A, assetId, 'missing', {
      type: 'contribution', effectiveDate: '2026-10-10', amount: '1',
    })).rejects.toMatchObject({ code: 'MOVEMENT_NOT_FOUND' });

    const originalMovementId = await repository.addMovement(USER_A, assetId, {
      type: 'contribution', effectiveDate: '2026-10-10', amount: '1000',
    });
    const correction = await repository.correctMovement(USER_A, assetId, originalMovementId, {
      type: 'contribution', effectiveDate: '2026-10-10', amount: '900',
    });
    const before = await repository.listMovements(USER_A, assetId);

    await expect(repository.correctMovement(USER_A, assetId, correction.reversalMovementId, {
      type: 'contribution', effectiveDate: '2026-10-10', amount: '1',
    })).rejects.toMatchObject({ code: 'TECHNICAL_REVERSAL_IMMUTABLE' });
    expect(await repository.listMovements(USER_A, assetId)).toHaveLength(before.length);
  });

  it('keeps correction writes atomic when the resulting ledger is invalid', async () => {
    const repository = createLoanRepository(authenticatedDb(USER_A));
    const { assetId } = await repository.createLoan(USER_A, loanInput(), '710000');
    const originalMovementId = await repository.addMovement(USER_A, assetId, {
      type: 'contribution', effectiveDate: '2026-10-10', amount: '1000',
    });

    await expect(repository.correctMovement(USER_A, assetId, originalMovementId, {
      type: 'withdrawal', effectiveDate: '2026-10-10', amount: '800000',
    })).rejects.toMatchObject({ code: 'WITHDRAWAL_EXCEEDS_AVAILABLE_VALUE' });
    const movements = await repository.listMovements(USER_A, assetId);
    expect(movements).toHaveLength(2);
    expect(movements.some((movement) => movement.reversesMovementId)).toBe(false);
  });

  it.each(['closed', 'cancelled'])('rejects corrections on a %s loan', async (status) => {
    const repository = createLoanRepository(authenticatedDb(USER_A));
    const { assetId, movementId } = await repository.createLoan(USER_A, loanInput(), '710000');
    await repository.updateLoanMetadata(USER_A, assetId, { status });

    await expect(repository.correctMovement(USER_A, assetId, movementId, {
      type: 'contribution', effectiveDate: '2026-09-01', amount: '700000',
    })).rejects.toThrow(new RegExp(`status ${status}`));
    expect(await repository.listMovements(USER_A, assetId)).toHaveLength(1);
  });

  it('requires UID before attempting a correction query', async () => {
    const repository = createLoanRepository(authenticatedDb(USER_A));
    await expect(repository.correctMovement('', 'loan-1', 'movement-1', {
      type: 'contribution', effectiveDate: '2026-09-01', amount: '1',
    })).rejects.toThrow(/uid/);
  });

  it('enforces repository status transitions and blocks movements on terminal loans', async () => {
    const repository = createLoanRepository(authenticatedDb(USER_A));
    const { assetId } = await repository.createLoan(USER_A, loanInput(), '710000');
    await repository.updateLoanMetadata(USER_A, assetId, { status: 'closed' });
    await expect(repository.updateLoanMetadata(USER_A, assetId, { status: 'active' }))
      .rejects.toThrow(/terminal status/);
    await expect(repository.addMovement(USER_A, assetId, {
      type: 'contribution',
      effectiveDate: '2026-10-01',
      amount: '1',
    })).rejects.toThrow(/status closed/);
  });

  it('preserves the exact Reclus fixture through Firestore and the L1 engine', async () => {
    const repository = createLoanRepository(authenticatedDb(USER_A));
    const { assetId } = await repository.createLoan(USER_A, loanInput(), '710000');
    const restoredLoan = await repository.getLoan(USER_A, assetId);
    const restoredMovements = await repository.listMovements(USER_A, assetId);

    const result = calculateLoanAtDate({
      loan: toLoanEngineDefinition(restoredLoan),
      movements: restoredMovements.map(toLoanEngineMovement),
      asOfDate: '2027-09-01',
    });

    expect(result.value).toBe('824135.707583329087399561976781114935875');
  });
});
