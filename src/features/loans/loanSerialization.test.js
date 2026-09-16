import { describe, expect, it } from 'vitest';
import {
  LoanPersistenceValidationError,
  deserializeLoanFromFirestore,
  deserializeMovementFromFirestore,
  normalizeLoanMetadataUpdate,
  normalizeLoanForPersistence,
  normalizeMovementForPersistence,
  requireCanonicalAmount,
  requireCanonicalRate,
  serializeLoanForFirestore,
  serializeMovementForFirestore,
  serializeTermsChangeForFirestore,
  toLoanEngineDefinition,
  toLoanEngineMovement,
} from './loanSerialization';

const timestamp = Object.freeze({
  toDate: () => new Date('2026-09-01T00:00:00.000Z'),
});

function loan(overrides = {}) {
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
    ...overrides,
  };
}

function movement(overrides = {}) {
  return {
    type: 'contribution',
    effectiveDate: '2026-09-01',
    amount: '710000',
    ...overrides,
  };
}

function expectCode(callback, code) {
  expect(callback).toThrowError(LoanPersistenceValidationError);
  try {
    callback();
  } catch (error) {
    expect(error.code).toBe(code);
  }
}

describe('canonical decimal strings', () => {
  it.each(['0', '0.0125', '1', '1000.50', '999999999999999999.0001'])(
    'accepts valid rates: %s',
    (value) => expect(requireCanonicalRate(value)).toBe(value),
  );

  it.each(['710000', '1000.50', '0.01', '1.0'])(
    'accepts valid positive amounts: %s',
    (value) => expect(requireCanonicalAmount(value)).toBe(value),
  );

  it.each(['', '00', '01', '-1', '+1', '.5', '1.', '1e3', '0.00', ' 1', '1 '])(
    'rejects non-canonical rate strings: %s',
    (value) => expectCode(() => requireCanonicalRate(value), 'INVALID_RATE_DECIMAL'),
  );

  it.each(['', '00', '01', '-1', '+1', '.5', '1.', '1e3', '0', '0.00', ' 1', '1 '])(
    'rejects non-positive or non-canonical amounts: %s',
    (value) => expectCode(() => requireCanonicalAmount(value), 'INVALID_AMOUNT_DECIMAL'),
  );

  it('never accepts Number values for persisted money or rates', () => {
    expectCode(() => requireCanonicalRate(0.0125), 'INVALID_RATE_DECIMAL');
    expectCode(() => requireCanonicalAmount(710000), 'INVALID_AMOUNT_DECIMAL');
  });
});

describe('loan serialization', () => {
  it('roundtrips date-only and decimal strings without loss', () => {
    const serialized = serializeLoanForFirestore(loan(), {
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const restored = deserializeLoanFromFirestore(serialized, { id: 'loan-1' });

    expect(restored).toEqual({
      id: 'loan-1',
      ...loan(),
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(toLoanEngineDefinition(restored)).toEqual({
      name: 'Reclus',
      currency: 'USD',
      startDate: '2026-09-01',
      maturityDate: '2027-09-01',
      rate: '0.0125',
      rateType: 'monthly_effective',
      capitalizationFrequency: 'monthly',
      calculationVersion: 'loan-v1',
    });
  });

  it('accepts annual effective rate documents supported by L1', () => {
    expect(normalizeLoanForPersistence(loan({ rateType: 'annual_effective' })).rateType)
      .toBe('annual_effective');
  });

  it.each([
    [{ currency: 'EUR' }, 'INVALID_CURRENCY'],
    [{ startDate: '2026-02-30' }, 'INVALID_DATE_ONLY'],
    [{ maturityDate: '2026-09-01' }, 'INVALID_MATURITY_DATE'],
    [{ rate: '-1' }, 'INVALID_RATE_DECIMAL'],
    [{ status: 'matured' }, 'INVALID_STATUS'],
    [{ calculationVersion: 'loan-v2' }, 'INVALID_CALCULATION_VERSION'],
    [{ initialAmount: '710000' }, 'UNEXPECTED_FIELD'],
  ])('rejects invalid loan schema %#', (overrides, code) => {
    expectCode(() => normalizeLoanForPersistence(loan(overrides)), code);
  });

  it('requires Firestore Timestamp metadata when deserializing', () => {
    const document = { ...loan(), createdAt: '2026-09-01', updatedAt: timestamp };
    expectCode(() => deserializeLoanFromFirestore(document), 'INVALID_TIMESTAMP');
  });

  it('restricts direct metadata updates to status and always adds updatedAt', () => {
    expect(normalizeLoanMetadataUpdate({ status: 'closed' }, timestamp)).toEqual({
      status: 'closed',
      updatedAt: timestamp,
    });
    expectCode(() => normalizeLoanMetadataUpdate({ rate: '0.02' }, timestamp), 'UNEXPECTED_FIELD');
    expectCode(() => normalizeLoanMetadataUpdate({ name: 'Nuevo nombre' }, timestamp), 'UNEXPECTED_FIELD');
    expectCode(() => normalizeLoanMetadataUpdate({}, timestamp), 'EMPTY_UPDATE');
  });

  it('reads legacy loans without revision as revision zero', () => {
    const restored = deserializeLoanFromFirestore({
      ...loan(), createdAt: timestamp, updatedAt: timestamp,
    });
    expect(restored.revision).toBe(0);
  });

  it('serializes a closed append-only terms audit without derived values', () => {
    const before = {
      name: 'Reclus',
      currency: 'USD',
      startDate: '2026-09-01',
      maturityDate: '2027-09-01',
      rate: '0.0125',
      rateType: 'monthly_effective',
      capitalizationFrequency: 'monthly',
      calculationVersion: 'loan-v1',
    };
    expect(serializeTermsChangeForFirestore({
      kind: 'correction',
      before,
      after: { ...before, rate: '0.01' },
      reason: '  Carga original incorrecta  ',
      fromRevision: 0,
      toRevision: 1,
    }, { createdAt: timestamp })).toEqual({
      kind: 'correction',
      before,
      after: { ...before, rate: '0.01' },
      reason: 'Carga original incorrecta',
      fromRevision: 0,
      toRevision: 1,
      createdAt: timestamp,
    });
  });

  it('requires a reason and one-step revision in terms audits', () => {
    const snapshot = {
      name: 'Reclus', currency: 'USD', startDate: '2026-09-01', maturityDate: '2027-09-01',
      rate: '0.0125', rateType: 'monthly_effective', capitalizationFrequency: 'monthly',
      calculationVersion: 'loan-v1',
    };
    expectCode(() => serializeTermsChangeForFirestore({
      kind: 'correction', before: snapshot, after: snapshot, reason: ' ',
      fromRevision: 0, toRevision: 1,
    }, { createdAt: timestamp }), 'INVALID_REASON');
    expectCode(() => serializeTermsChangeForFirestore({
      kind: 'correction', before: snapshot, after: snapshot, reason: 'Corrección',
      fromRevision: 0, toRevision: 2,
    }, { createdAt: timestamp }), 'INVALID_REVISION');
  });
});

describe('movement serialization', () => {
  it('roundtrips optional metadata while keeping the L1 input minimal', () => {
    const source = movement({ note: 'Alta', reversesMovementId: 'old-movement' });
    const serialized = serializeMovementForFirestore(source, { createdAt: timestamp });
    const restored = deserializeMovementFromFirestore(serialized, { id: 'movement-1' });

    expect(restored).toEqual({ id: 'movement-1', ...source, createdAt: timestamp });
    expect(toLoanEngineMovement(restored)).toEqual({
      type: 'contribution',
      effectiveDate: '2026-09-01',
      amount: '710000',
    });
  });

  it.each([
    [{ type: 'interest' }, 'INVALID_MOVEMENT_TYPE'],
    [{ effectiveDate: '2026-13-01' }, 'INVALID_DATE_ONLY'],
    [{ amount: '0' }, 'INVALID_AMOUNT_DECIMAL'],
    [{ amount: 10 }, 'INVALID_AMOUNT_DECIMAL'],
    [{ arbitrary: true }, 'UNEXPECTED_FIELD'],
  ])('rejects invalid movement schema %#', (overrides, code) => {
    expectCode(() => normalizeMovementForPersistence(movement(overrides)), code);
  });
});
