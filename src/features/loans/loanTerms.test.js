import { describe, expect, it } from 'vitest';
import {
  buildLoanTermsCandidate,
  calculateLoanTermsChangePreview,
} from './loanTerms';

const loan = Object.freeze({
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
  revision: 0,
});

const movements = Object.freeze([
  Object.freeze({
    id: 'initial',
    effectiveDate: '2026-09-01',
    type: 'contribution',
    amount: '710000',
  }),
  Object.freeze({
    id: 'later',
    effectiveDate: '2027-03-01',
    type: 'contribution',
    amount: '10000',
  }),
]);

function preview(overrides = {}) {
  return calculateLoanTermsChangePreview({
    loan,
    movements,
    kind: 'correction',
    changes: { rate: '0.01' },
    asOfDate: '2027-04-01',
    ...overrides,
  });
}

describe('retroactive loan terms correction', () => {
  it('corrects rate through L1 and returns current and proposed values and projections', () => {
    const result = preview();
    expect(result.currentTerms.rate).toBe('0.0125');
    expect(result.proposedTerms.rate).toBe('0.01');
    expect(result.currentValue.value).not.toBe(result.proposedValue.value);
    expect(result.currentProjection.maturityDate).toBe('2027-09-01');
    expect(result.proposedProjection.maturityDate).toBe('2027-09-01');
  });

  it('corrects rateType retroactively', () => {
    const result = preview({ changes: { rateType: 'annual_effective' } });
    expect(result.proposedTerms.rateType).toBe('annual_effective');
    expect(result.currentValue.value).not.toBe(result.proposedValue.value);
  });

  it('builds a valid startDate candidate but requires a contribution on the corrected date', () => {
    expect(buildLoanTermsCandidate({
      loan,
      kind: 'correction',
      changes: { startDate: '2026-08-15' },
    }).startDate).toBe('2026-08-15');
    expect(() => preview({ changes: { startDate: '2026-08-15' } }))
      .toThrowError(expect.objectContaining({ code: 'START_DATE_REQUIRES_CONTRIBUTION' }));
  });

  it('does not count a neutralized contribution as the required corrected startDate contribution', () => {
    const auditLedger = [
      ...movements,
      {
        id: 'candidate-start',
        effectiveDate: '2026-08-15',
        type: 'contribution',
        amount: '1000',
      },
      {
        id: 'candidate-start-reversal',
        effectiveDate: '2026-08-15',
        type: 'withdrawal',
        amount: '1000',
        reversesMovementId: 'candidate-start',
      },
    ];

    expect(() => preview({
      movements: auditLedger,
      changes: { startDate: '2026-08-15' },
    })).toThrowError(expect.objectContaining({ code: 'START_DATE_REQUIRES_CONTRIBUTION' }));
  });

  it('accepts a valid maturity correction and rejects one before an existing movement', () => {
    expect(preview({ changes: { maturityDate: '2027-06-01' } }).proposedTerms.maturityDate)
      .toBe('2027-06-01');
    expect(() => preview({ changes: { maturityDate: '2027-02-01' } }))
      .toThrowError(expect.objectContaining({ code: 'MOVEMENT_AFTER_MATURITY' }));
  });

  it.each([
    ['currency', { currency: 'ARS' }],
    ['calculationVersion', { calculationVersion: 'loan-v2' }],
    ['capitalizationFrequency', { capitalizationFrequency: 'daily' }],
    ['initial amount', { initialAmount: '1' }],
  ])('rejects unsupported %s edits', (_label, changes) => {
    expect(() => buildLoanTermsCandidate({ loan, kind: 'correction', changes }))
      .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_TERMS_FIELD' }));
  });

  it('rejects terms changes on terminal loans', () => {
    expect(() => preview({ loan: { ...loan, status: 'closed' } }))
      .toThrowError(expect.objectContaining({ code: 'LOAN_STATUS_NOT_ACTIVE' }));
  });
});

describe('maturity extension', () => {
  it('extends a future maturity without changing rate or movements', () => {
    const originalMovements = structuredClone(movements);
    const result = preview({
      kind: 'maturity_extension',
      changes: { maturityDate: '2028-03-01' },
      asOfDate: '2027-04-01',
    });
    expect(result.proposedTerms.maturityDate).toBe('2028-03-01');
    expect(result.proposedTerms.rate).toBe(result.currentTerms.rate);
    expect(result.proposedTerms.rateType).toBe(result.currentTerms.rateType);
    expect(result.proposedProjection.maturityDate).toBe('2028-03-01');
    expect(movements).toEqual(originalMovements);
    expect(result.continuesAccrualAfterOriginalMaturity).toBe(false);
  });

  it('flags continued accrual when extending an already matured loan', () => {
    const result = preview({
      kind: 'maturity_extension',
      changes: { maturityDate: '2028-03-01' },
      asOfDate: '2027-10-01',
    });
    expect(result.continuesAccrualAfterOriginalMaturity).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'ACCRUAL_CONTINUES_AFTER_ORIGINAL_MATURITY' }),
    ]);
    expect(Number(result.proposedValue.value)).toBeGreaterThan(Number(result.currentValue.value));
  });

  it('requires a strictly later maturity and permits no other change', () => {
    expect(() => preview({
      kind: 'maturity_extension',
      changes: { maturityDate: loan.maturityDate },
    })).toThrowError(expect.objectContaining({ code: 'EMPTY_TERMS_CHANGE' }));
    expect(() => preview({
      kind: 'maturity_extension',
      changes: { maturityDate: '2026-12-01' },
    })).toThrowError(expect.objectContaining({ code: 'INVALID_MATURITY_EXTENSION' }));
    expect(() => preview({
      kind: 'maturity_extension',
      changes: { maturityDate: '2028-01-01', rate: '0.02' },
    })).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_TERMS_FIELD' }));
  });
});
