import { describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import {
  LoanFormValidationError,
  buildLoanCreationInput,
  buildLoanTermsChangeInput,
  buildMovementInput,
  canonicalAmountToHuman,
  deriveLoanPresentation,
  effectiveLoanStatus,
  formatRatePercent,
  humanAmountToCanonical,
  humanPercentToRate,
  loadLoanCards,
  loadLoanDetail,
  loanTermsErrorMessage,
  loanTermsFormValues,
  movementFormValues,
  movementDeleteErrorMessage,
  movementSaveErrorMessage,
  previewLoanValueAfterMovement,
  previewLoanValueAfterMovementDeletion,
  submitLoanCreation,
  submitLoanMovement,
  submitLoanMovementDeletion,
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
    expect(canonicalAmountToHuman('1000.50')).toBe('1000,5');
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
    expect(result.visibleMovements).toEqual(reclusMovements);
  });

  it('derives maturity while preserving stored terminal statuses', () => {
    expect(effectiveLoanStatus(reclusLoan, '2027-09-01')).toBe('matured');
    expect(effectiveLoanStatus({ ...reclusLoan, status: 'closed' }, '2027-09-02')).toBe('closed');
    expect(effectiveLoanStatus({ ...reclusLoan, status: 'cancelled' }, '2026-10-01')).toBe('cancelled');
  });
});

describe('movement form contract', () => {
  const movementForm = Object.freeze({
    type: 'withdrawal',
    effectiveDate: '2026-10-15',
    amount: '1.234,50',
    note: ' Corrección ',
  });

  it('calculates with the full audit ledger but exposes only the effective replacement', () => {
    const movements = [
      reclusMovements[0],
      {
        id: 'reverse-initial',
        type: 'withdrawal',
        effectiveDate: '2026-09-01',
        amount: '710000',
        reversesMovementId: 'initial-contribution',
      },
      {
        id: 'replacement',
        type: 'contribution',
        effectiveDate: '2026-09-01',
        amount: '700000',
      },
    ];
    const result = deriveLoanPresentation({ loan: reclusLoan, movements, asOfDate: '2026-10-01' });
    const equivalent = deriveLoanPresentation({
      loan: reclusLoan,
      movements: [movements[2]],
      asOfDate: '2026-10-01',
    });

    expect(result.valuation.value).toBe(equivalent.valuation.value);
    expect(result.movements).toHaveLength(3);
    expect(result.visibleMovements.map((movement) => movement.id)).toEqual(['replacement']);
  });

  it('maps human Ingreso/Retiro data to a canonical movement', () => {
    expect(buildMovementInput(movementForm, reclusLoan)).toEqual({
      type: 'withdrawal',
      effectiveDate: '2026-10-15',
      amount: '1234.5',
      note: 'Corrección',
    });
    expect(buildMovementInput({ ...movementForm, type: 'contribution', note: ' ' }, reclusLoan))
      .toEqual({ type: 'contribution', effectiveDate: '2026-10-15', amount: '1234.5' });
  });

  it('prefills edit values without converting money through Number', () => {
    expect(movementFormValues({
      loan: reclusLoan,
      movement: { ...reclusMovements[0], amount: '710000.50', note: 'Inicial' },
    })).toEqual({
      type: 'contribution',
      effectiveDate: '2026-09-01',
      amount: '710000,5',
      note: 'Inicial',
    });
  });

  it('clamps the default date to the contractual range', () => {
    expect(movementFormValues({ loan: reclusLoan, now: new Date(2026, 7, 1) }).effectiveDate)
      .toBe('2026-09-01');
    expect(movementFormValues({ loan: reclusLoan, now: new Date(2027, 9, 1) }).effectiveDate)
      .toBe('2027-09-01');
  });

  it.each([
    [{ type: 'interest' }, 'type'],
    [{ effectiveDate: '2026-08-31' }, 'effectiveDate'],
    [{ effectiveDate: '2027-09-02' }, 'effectiveDate'],
    [{ effectiveDate: '' }, 'effectiveDate'],
    [{ amount: '0' }, 'amount'],
    [{ note: 'x'.repeat(501) }, 'note'],
  ])('rejects invalid movement form data %#', (changes, field) => {
    expect(() => buildMovementInput({ ...movementForm, ...changes }, reclusLoan))
      .toThrowError(expect.objectContaining({ field }));
  });

  it('routes add and edit through the authenticated repository contract', async () => {
    const repository = {
      addMovement: vi.fn().mockResolvedValue('movement-new'),
      correctMovement: vi.fn().mockResolvedValue({ replacementMovementId: 'movement-b' }),
    };

    await submitLoanMovement({
      uid: 'user-123',
      loanId: 'reclus-id',
      loan: reclusLoan,
      form: movementForm,
      repository,
    });
    await submitLoanMovement({
      uid: 'user-123',
      loanId: 'reclus-id',
      loan: reclusLoan,
      movementId: 'movement-a',
      form: movementForm,
      repository,
    });

    expect(repository.addMovement).toHaveBeenCalledWith(
      'user-123',
      'reclus-id',
      expect.objectContaining({ type: 'withdrawal', amount: '1234.5' }),
    );
    expect(repository.correctMovement).toHaveBeenCalledWith(
      'user-123',
      'reclus-id',
      'movement-a',
      expect.objectContaining({ note: 'Corrección' }),
    );
  });

  it('never calls the repository without UID', async () => {
    const repository = { addMovement: vi.fn(), correctMovement: vi.fn() };
    await expect(submitLoanMovement({
      uid: '',
      loanId: 'reclus-id',
      loan: reclusLoan,
      form: movementForm,
      repository,
    })).rejects.toMatchObject({ field: 'auth' });
    expect(repository.addMovement).not.toHaveBeenCalled();
    expect(repository.correctMovement).not.toHaveBeenCalled();
  });

  it('maps deterministic operation errors to human messages', () => {
    expect(movementSaveErrorMessage({ code: 'WITHDRAWAL_EXCEEDS_AVAILABLE_VALUE' }))
      .toMatch(/supera el valor disponible/i);
    expect(movementSaveErrorMessage(new Error('Cannot add movements to a loan with status closed')))
      .toMatch(/cerrado o cancelado/i);
    expect(movementSaveErrorMessage({ code: 'MISSING_CONTRIBUTION' }))
      .toMatch(/al menos un ingreso/i);
  });

  it('requires an audit reason and routes deletion through the authenticated repository', async () => {
    const repository = { deleteMovement: vi.fn().mockResolvedValue({ reversalMovementId: 'void-a' }) };

    await expect(submitLoanMovementDeletion({
      uid: 'user-123',
      loanId: 'reclus-id',
      movementId: 'movement-a',
      reason: '  Duplicado  ',
      repository,
    })).resolves.toEqual({ reversalMovementId: 'void-a' });
    expect(repository.deleteMovement).toHaveBeenCalledWith(
      'user-123',
      'reclus-id',
      'movement-a',
      'Duplicado',
    );

    await expect(submitLoanMovementDeletion({
      uid: 'user-123',
      loanId: 'reclus-id',
      movementId: 'movement-a',
      reason: ' ',
      repository,
    })).rejects.toMatchObject({ field: 'reason' });
  });

  it('maps deletion failures without exposing internal codes', () => {
    expect(movementDeleteErrorMessage({ code: 'CONTRIBUTION_REQUIRED' }))
      .toMatch(/al menos un ingreso/i);
    expect(movementDeleteErrorMessage({ code: 'MOVEMENT_ALREADY_REVERSED' }))
      .toMatch(/ya fue eliminado o corregido/i);
  });
});

describe('audited loan terms UI contract', () => {
  it('prefills canonical terms as human form values', () => {
    expect(loanTermsFormValues(reclusLoan)).toEqual({
      name: 'Reclus',
      startDate: '2026-09-01',
      maturityDate: '2027-09-01',
      rateType: 'monthly_effective',
      rate: '1,25',
      newMaturityDate: '2027-09-01',
      reason: '',
    });
  });

  it('builds a trimmed retroactive correction containing only changed fields', () => {
    const input = buildLoanTermsChangeInput({
      loan: reclusLoan,
      mode: 'correction',
      asOfDate: '2026-10-01',
      form: {
        ...loanTermsFormValues(reclusLoan),
        name: ' Reclus corregido ',
        rate: '1,50',
        reason: '  Error de carga  ',
      },
    });

    expect(input).toEqual({
      kind: 'correction',
      changes: { name: 'Reclus corregido', rate: '0.015' },
      asOfDate: '2026-10-01',
      reason: 'Error de carga',
    });
  });

  it('builds a maturity-only extension and rejects a non-extension', () => {
    const baseForm = loanTermsFormValues(reclusLoan);
    expect(buildLoanTermsChangeInput({
      loan: reclusLoan,
      mode: 'maturity_extension',
      asOfDate: '2027-10-01',
      form: { ...baseForm, newMaturityDate: '2028-03-01', reason: 'Renovación' },
    })).toEqual({
      kind: 'maturity_extension',
      changes: { maturityDate: '2028-03-01' },
      asOfDate: '2027-10-01',
      reason: 'Renovación',
    });
    expect(() => buildLoanTermsChangeInput({
      loan: reclusLoan,
      mode: 'maturity_extension',
      asOfDate: '2027-10-01',
      form: { ...baseForm, reason: 'Sin cambio' },
    })).toThrowError(expect.objectContaining({ field: 'newMaturityDate' }));
  });

  it('requires a reason and maps concurrency and ledger failures to human messages', () => {
    expect(() => buildLoanTermsChangeInput({
      loan: reclusLoan,
      mode: 'correction',
      asOfDate: '2026-10-01',
      form: { ...loanTermsFormValues(reclusLoan), rate: '1,5' },
    })).toThrowError(expect.objectContaining({ field: 'reason' }));
    expect(loanTermsErrorMessage({ code: 'STALE_LOAN_TERMS_REVISION' }))
      .toMatch(/otra sesión/i);
    expect(loanTermsErrorMessage({ code: 'MOVEMENT_BEFORE_START_DATE' }))
      .toMatch(/movimientos anteriores/i);
    expect(loanTermsErrorMessage({ code: 'MOVEMENT_AFTER_MATURITY' }))
      .toMatch(/fuera de la vigencia/i);
    expect(loanTermsErrorMessage({ code: 'WITHDRAWAL_EXCEEDS_AVAILABLE_VALUE' }))
      .toMatch(/sin saldo suficiente/i);
    expect(loanTermsErrorMessage({ code: 'MISSING_CONTRIBUTION' }))
      .toMatch(/al menos un ingreso/i);
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

describe('movement outcome previews', () => {
  const asOfDate = '2027-03-01';

  it('values an added movement through the same ledger the repository will write', () => {
    const before = deriveLoanPresentation({
      loan: reclusLoan,
      movements: [...reclusMovements],
      asOfDate,
    });
    const after = previewLoanValueAfterMovement({
      loan: reclusLoan,
      movements: [...reclusMovements],
      asOfDate,
      form: { type: 'contribution', effectiveDate: asOfDate, amount: '25.000', note: '' },
    });

    expect(new Decimal(after.value).minus(before.valuation.value).toString()).toBe('25000');
  });

  it('values a correction as the reversal plus replacement pair', () => {
    const after = previewLoanValueAfterMovement({
      loan: reclusLoan,
      movements: [...reclusMovements],
      asOfDate,
      movementId: 'initial-contribution',
      form: { type: 'contribution', effectiveDate: '2026-09-01', amount: '700.000', note: '' },
    });
    const corrected = deriveLoanPresentation({
      loan: reclusLoan,
      movements: [{ ...reclusMovements[0], amount: '700000' }],
      asOfDate,
    });

    expect(after.value).toBe(corrected.valuation.value);
  });

  it('values a deletion as the loan without that movement', () => {
    const movements = [
      ...reclusMovements,
      { id: 'later', effectiveDate: '2026-12-01', type: 'contribution', amount: '40000' },
    ];
    const after = previewLoanValueAfterMovementDeletion({
      loan: reclusLoan,
      movements,
      asOfDate,
      movementId: 'later',
    });
    const withoutIt = deriveLoanPresentation({
      loan: reclusLoan,
      movements: [...reclusMovements],
      asOfDate,
    });

    expect(after.value).toBe(withoutIt.valuation.value);
  });

  it('rejects an incomplete form so the caller can show nothing yet', () => {
    expect(() => previewLoanValueAfterMovement({
      loan: reclusLoan,
      movements: [...reclusMovements],
      asOfDate,
      form: { type: 'contribution', effectiveDate: asOfDate, amount: '', note: '' },
    })).toThrow(LoanFormValidationError);
  });
});
