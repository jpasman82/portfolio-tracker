import { describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import {
  LoanFormValidationError,
  buildLoanCreationInput,
  deriveLoanPresentation,
  effectiveLoanStatus,
  formatRatePercent,
  humanAmountToCanonical,
  humanPercentToRate,
  loadLoanCards,
  loadLoanDetail,
  submitLoanCreation,
  todayDateOnly,
} from './loanUi';

const reclusLoan = Object.freeze({
  id: 'reclus-id',
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
});

const reclusMovements = Object.freeze([
  Object.freeze({
    id: 'initial-contribution',
    effectiveDate: '2026-09-01',
    type: 'contribution',
    amount: '710000',
  }),
]);

const validForm = Object.freeze({
  name: ' Reclus ',
  currency: 'USD',
  startDate: '2026-09-01',
  maturityDate: '2027-09-01',
  rateType: 'monthly_effective',
  rate: '1,25',
  initialAmount: '710.000',
});

describe('loan UI decimal and date-only helpers', () => {
  it('converts rates between human percentages and canonical decimal strings', () => {
    expect(humanPercentToRate('1,25')).toBe('0.0125');
    expect(formatRatePercent('0.0125')).toBe('1,25 %');
  });

  it('converts locale-friendly money without using a persisted Number', () => {
    expect(humanAmountToCanonical('710.000')).toBe('710000');
    expect(humanAmountToCanonical('1.234,50')).toBe('1234.5');
    expect(humanAmountToCanonical('1000.50')).toBe('1000.5');
  });

  it('builds today from the local calendar rather than a UTC slice', () => {
    expect(todayDateOnly(new Date(2026, 8, 13, 23, 59, 59))).toBe('2026-09-13');
  });
});

describe('Activos financial derivation', () => {
  it('delegates Reclus current value and maturity projection to L1', () => {
    const result = deriveLoanPresentation({
      loan: reclusLoan,
      movements: reclusMovements,
      asOfDate: '2026-10-01',
    });

    expect(result.valuation.value).toBe('718875');
    expect(new Decimal(result.projection.projectedMaturityValue).toFixed(2)).toBe('824135.71');
  });

  it('derives maturity while preserving stored terminal statuses', () => {
    expect(effectiveLoanStatus(reclusLoan, '2027-09-01')).toBe('matured');
    expect(effectiveLoanStatus({ ...reclusLoan, status: 'closed' }, '2027-09-02')).toBe('closed');
    expect(effectiveLoanStatus({ ...reclusLoan, status: 'cancelled' }, '2026-10-01')).toBe('cancelled');
  });
});

describe('new loan form contract', () => {
  it('creates canonical loan data and a separate initial contribution', () => {
    expect(buildLoanCreationInput(validForm)).toEqual({
      loan: {
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
      },
      initialContribution: { amount: '710000' },
    });
  });

  it.each([
    [{ name: '' }, 'name'],
    [{ currency: '' }, 'currency'],
    [{ startDate: '' }, 'startDate'],
    [{ maturityDate: '2026-09-01' }, 'maturityDate'],
    [{ rateType: '' }, 'rateType'],
    [{ rate: '' }, 'rate'],
    [{ initialAmount: '0' }, 'initialAmount'],
  ])('rejects invalid required input %#', (changes, field) => {
    try {
      buildLoanCreationInput({ ...validForm, ...changes });
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(LoanFormValidationError);
      expect(error.field).toBe(field);
    }
  });

  it('passes the authenticated UID and canonical payload to the repository', async () => {
    const repository = { createLoan: vi.fn().mockResolvedValue({ assetId: 'loan-1' }) };

    const created = await submitLoanCreation({ uid: 'user-123', form: validForm, repository });

    expect(created).toEqual({ assetId: 'loan-1' });
    expect(repository.createLoan).toHaveBeenCalledOnce();
    expect(repository.createLoan).toHaveBeenCalledWith(
      'user-123',
      expect.objectContaining({ name: 'Reclus', rate: '0.0125' }),
      { amount: '710000' },
    );
  });
});

describe('authenticated repository access', () => {
  it('does not query lists or details without a UID', async () => {
    const repository = {
      listLoans: vi.fn(),
      getLoan: vi.fn(),
      listMovements: vi.fn(),
    };

    await expect(loadLoanCards({ uid: '', repository, asOfDate: '2026-10-01' })).resolves.toEqual([]);
    await expect(loadLoanDetail({ uid: null, loanId: 'loan-1', repository, asOfDate: '2026-10-01' })).resolves.toBeNull();
    expect(repository.listLoans).not.toHaveBeenCalled();
    expect(repository.getLoan).not.toHaveBeenCalled();
    expect(repository.listMovements).not.toHaveBeenCalled();
  });

  it('uses the same UID for the loan list and each movement namespace', async () => {
    const repository = {
      listLoans: vi.fn().mockResolvedValue([reclusLoan]),
      listMovements: vi.fn().mockResolvedValue(reclusMovements),
    };

    const cards = await loadLoanCards({ uid: 'user-123', repository, asOfDate: '2026-10-01' });

    expect(cards).toHaveLength(1);
    expect(repository.listLoans).toHaveBeenCalledWith('user-123');
    expect(repository.listMovements).toHaveBeenCalledWith('user-123', 'reclus-id');
  });

  it('loads a detail entirely inside the authenticated UID namespace', async () => {
    const repository = {
      getLoan: vi.fn().mockResolvedValue(reclusLoan),
      listMovements: vi.fn().mockResolvedValue(reclusMovements),
    };

    const detail = await loadLoanDetail({
      uid: 'user-123',
      loanId: 'reclus-id',
      repository,
      asOfDate: '2026-10-01',
    });

    expect(detail.loan.name).toBe('Reclus');
    expect(repository.getLoan).toHaveBeenCalledWith('user-123', 'reclus-id');
    expect(repository.listMovements).toHaveBeenCalledWith('user-123', 'reclus-id');
  });

  it('rejects creation before calling the repository when UID is absent', async () => {
    const repository = { createLoan: vi.fn() };

    await expect(submitLoanCreation({ uid: '', form: validForm, repository }))
      .rejects.toMatchObject({ field: 'auth' });
    expect(repository.createLoan).not.toHaveBeenCalled();
  });
});
