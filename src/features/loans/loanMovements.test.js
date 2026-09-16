import { describe, expect, it } from 'vitest';
import { calculateLoanAtDate } from './loanEngine';
import {
  effectiveMovements,
  prepareMovementCorrection,
  prepareMovementDeletion,
  validateCompleteLoanLedger,
  validateMovementDeletionLedger,
} from './loanMovements';
import { toLoanEngineDefinition, toLoanEngineMovement } from './loanSerialization';

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

const initial = Object.freeze({
  id: 'initial',
  type: 'contribution',
  effectiveDate: '2026-09-01',
  amount: '710000',
});

function valueAt(movements, asOfDate) {
  return calculateLoanAtDate({
    loan: toLoanEngineDefinition(loan),
    movements: movements.map(toLoanEngineMovement),
    asOfDate,
  }).value;
}

describe('complete ledger validation', () => {
  it('accepts backdated contributions and withdrawals when the entire ledger remains solvent', () => {
    expect(() => validateCompleteLoanLedger({
      loan,
      movements: [
        initial,
        { type: 'withdrawal', effectiveDate: '2026-12-01', amount: '500000' },
        { type: 'contribution', effectiveDate: '2026-10-15', amount: '1000' },
        { type: 'withdrawal', effectiveDate: '2026-10-20', amount: '500' },
      ],
    })).not.toThrow();
  });

  it('rejects a backdated withdrawal that makes a later withdrawal insolvent', () => {
    expect(() => validateCompleteLoanLedger({
      loan,
      movements: [
        initial,
        { type: 'withdrawal', effectiveDate: '2026-12-01', amount: '500000' },
        { type: 'withdrawal', effectiveDate: '2026-10-15', amount: '300000' },
      ],
    })).toThrowError(expect.objectContaining({ code: 'WITHDRAWAL_EXCEEDS_AVAILABLE_VALUE' }));
  });
});

describe('append-only movement corrections', () => {
  it('corrects the initial contribution without introducing initialAmount', () => {
    const correction = prepareMovementCorrection({
      movements: [initial],
      movementId: initial.id,
      correctedData: {
        type: 'contribution',
        effectiveDate: '2026-09-01',
        amount: '700000',
      },
    });

    expect(valueAt(correction.resultingMovements, '2027-09-01')).toBe(
      valueAt([{ ...initial, amount: '700000' }], '2027-09-01'),
    );
  });

  it('corrects an amount with economics identical to the corrected movement alone', () => {
    const original = {
      id: 'movement-a',
      type: 'contribution',
      effectiveDate: '2026-10-15',
      amount: '100000',
      note: 'Original',
    };
    const correction = prepareMovementCorrection({
      movements: [initial, original],
      movementId: original.id,
      correctedData: {
        type: original.type,
        effectiveDate: original.effectiveDate,
        amount: '80000',
        note: 'Corregido',
      },
    });

    expect(correction.reversal).toEqual({
      type: 'withdrawal',
      effectiveDate: '2026-10-15',
      amount: '100000',
      reversesMovementId: 'movement-a',
    });
    expect(valueAt(correction.resultingMovements, '2027-03-01')).toBe(
      valueAt([initial, { ...original, amount: '80000' }], '2027-03-01'),
    );
  });

  it('corrects a date by reversing on the original date and replacing on the new date', () => {
    const original = {
      id: 'movement-a',
      type: 'contribution',
      effectiveDate: '2026-10-10',
      amount: '100000',
    };
    const correction = prepareMovementCorrection({
      movements: [initial, original],
      movementId: original.id,
      correctedData: {
        type: 'contribution',
        effectiveDate: '2026-10-15',
        amount: '100000',
      },
    });

    expect(valueAt(correction.resultingMovements, '2026-10-14')).toBe(valueAt([initial], '2026-10-14'));
    expect(valueAt(correction.resultingMovements, '2026-10-15')).toBe(
      valueAt([initial, correction.replacement], '2026-10-15'),
    );
  });

  it('corrects contribution to withdrawal through the engine without special allocation rules', () => {
    const original = {
      id: 'movement-a',
      type: 'contribution',
      effectiveDate: '2026-10-15',
      amount: '1000',
    };
    const correction = prepareMovementCorrection({
      movements: [initial, original],
      movementId: original.id,
      correctedData: { type: 'withdrawal', effectiveDate: '2026-10-15', amount: '1000' },
    });

    expect(() => validateCompleteLoanLedger({ loan, movements: correction.resultingMovements })).not.toThrow();
    expect(valueAt(correction.resultingMovements, '2026-11-01')).toBe(
      valueAt([initial, correction.replacement], '2026-11-01'),
    );
  });

  it('preserves a corrected note only on the replacement', () => {
    const original = { ...initial, id: 'movement-a', note: 'Antes' };
    const correction = prepareMovementCorrection({
      movements: [original],
      movementId: original.id,
      correctedData: {
        type: initial.type,
        effectiveDate: initial.effectiveDate,
        amount: initial.amount,
        note: 'Después',
      },
    });

    expect(correction.reversal.note).toBeUndefined();
    expect(correction.replacement.note).toBe('Después');
  });

  it('rejects unknown movements and direct edits of technical reversals', () => {
    expect(() => prepareMovementCorrection({
      movements: [initial],
      movementId: 'missing',
      correctedData: initial,
    })).toThrowError(expect.objectContaining({ code: 'MOVEMENT_NOT_FOUND' }));

    expect(() => prepareMovementCorrection({
      movements: [{ ...initial, id: 'reversal', reversesMovementId: 'initial' }],
      movementId: 'reversal',
      correctedData: initial,
    })).toThrowError(expect.objectContaining({ code: 'TECHNICAL_REVERSAL_IMMUTABLE' }));
  });

  it('rejects a second correction of an already neutralized original', () => {
    expect(() => prepareMovementCorrection({
      movements: [
        initial,
        { id: 'reverse-a', type: 'withdrawal', effectiveDate: initial.effectiveDate, amount: initial.amount, reversesMovementId: initial.id },
      ],
      movementId: initial.id,
      correctedData: { type: 'contribution', effectiveDate: initial.effectiveDate, amount: '700000' },
    })).toThrowError(expect.objectContaining({ code: 'MOVEMENT_ALREADY_REVERSED' }));
  });
});

describe('effective movement projection', () => {
  it('hides reversals and reversed originals while keeping the replacement', () => {
    const ledger = [
      initial,
      { id: 'reverse-a', type: 'withdrawal', effectiveDate: '2026-09-01', amount: '710000', reversesMovementId: 'initial' },
      { id: 'replacement-b', type: 'contribution', effectiveDate: '2026-09-01', amount: '700000' },
    ];

    expect(effectiveMovements(ledger).map((movement) => movement.id)).toEqual(['replacement-b']);
  });

  it('supports a second correction and is independent of Firestore return order', () => {
    const ledger = [
      initial,
      { id: 'reverse-a', type: 'withdrawal', effectiveDate: '2026-09-01', amount: '710000', reversesMovementId: 'initial' },
      { id: 'replacement-b', type: 'contribution', effectiveDate: '2026-09-01', amount: '700000' },
      { id: 'reverse-b', type: 'withdrawal', effectiveDate: '2026-09-01', amount: '700000', reversesMovementId: 'replacement-b' },
      { id: 'replacement-c', type: 'contribution', effectiveDate: '2026-09-01', amount: '690000' },
    ];

    expect(effectiveMovements(ledger).map((movement) => movement.id)).toEqual(['replacement-c']);
    expect(valueAt(ledger, '2027-09-01')).toBe(valueAt([...ledger].reverse(), '2027-09-01'));
  });
});

describe('auditable movement deletion', () => {
  it.each([
    ['contribution', { id: 'target', type: 'contribution', effectiveDate: '2026-10-01', amount: '1000' }],
    ['withdrawal', { id: 'target', type: 'withdrawal', effectiveDate: '2026-10-01', amount: '1000' }],
  ])('neutralizes a %s with an opposite append-only movement', (_label, target) => {
    const ledger = [initial, target];
    const deletion = prepareMovementDeletion({
      movements: ledger,
      movementId: target.id,
      reason: 'Carga duplicada',
    });
    expect(deletion.reversal).toEqual({
      type: target.type === 'contribution' ? 'withdrawal' : 'contribution',
      effectiveDate: target.effectiveDate,
      amount: target.amount,
      note: 'Carga duplicada',
      reversesMovementId: target.id,
    });
    expect(valueAt(deletion.resultingMovements, '2027-09-01'))
      .toBe(valueAt([initial], '2027-09-01'));
    expect(effectiveMovements(deletion.resultingMovements).map(({ id }) => id)).toEqual(['initial']);
  });

  it('moves the initial contribution forward while the loan remains valid', () => {
    const correction = prepareMovementCorrection({
      movements: [initial],
      movementId: initial.id,
      correctedData: {
        type: 'contribution',
        effectiveDate: '2026-09-15',
        amount: initial.amount,
      },
    });

    expect(() => validateCompleteLoanLedger({
      loan,
      movements: correction.resultingMovements,
    })).not.toThrow();
    expect(valueAt(correction.resultingMovements, '2026-09-14')).toBe('0');
    expect(valueAt(correction.resultingMovements, '2026-09-15')).toBe(initial.amount);
  });

  it('deletes a backdated contribution only when the complete future ledger remains solvent', () => {
    const contribution = { id: 'backdated', type: 'contribution', effectiveDate: '2026-10-01', amount: '1000' };
    const deletion = prepareMovementDeletion({
      movements: [initial, contribution],
      movementId: contribution.id,
      reason: 'Duplicado',
    });
    expect(() => validateCompleteLoanLedger({ loan, movements: deletion.resultingMovements })).not.toThrow();
  });

  it('rejects deleting a contribution when a later withdrawal becomes insolvent', () => {
    const contribution = { id: 'needed', type: 'contribution', effectiveDate: '2026-10-01', amount: '100000' };
    const withdrawal = { id: 'later-withdrawal', type: 'withdrawal', effectiveDate: '2026-10-02', amount: '800000' };
    const deletion = prepareMovementDeletion({
      movements: [initial, contribution, withdrawal],
      movementId: contribution.id,
      reason: 'Anulación solicitada',
    });
    expect(() => validateMovementDeletionLedger({ loan, movements: deletion.resultingMovements }))
      .toThrowError(expect.objectContaining({ code: 'WITHDRAWAL_EXCEEDS_AVAILABLE_VALUE' }));
  });

  it('allows deleting the first contribution when another effective contribution remains', () => {
    const later = {
      id: 'later-contribution',
      type: 'contribution',
      effectiveDate: '2026-09-15',
      amount: '1000',
    };
    const deletion = prepareMovementDeletion({
      movements: [initial, later],
      movementId: initial.id,
      reason: 'Alta equivocada',
    });
    expect(() => validateMovementDeletionLedger({ loan, movements: deletion.resultingMovements }))
      .not.toThrow();
    expect(valueAt(deletion.resultingMovements, '2026-09-14')).toBe('0');
  });

  it('rejects deleting the only effective contribution', () => {
    const deletion = prepareMovementDeletion({
      movements: [initial],
      movementId: initial.id,
      reason: 'Alta equivocada',
    });
    expect(() => validateMovementDeletionLedger({ loan, movements: deletion.resultingMovements }))
      .toThrowError(expect.objectContaining({ code: 'CONTRIBUTION_REQUIRED' }));
  });

  it('deletes the current replacement while preserving the correction chain', () => {
    const ledger = [
      initial,
      { id: 'reverse-a', type: 'withdrawal', effectiveDate: '2026-09-01', amount: '710000', reversesMovementId: 'initial' },
      { id: 'replacement-b', type: 'contribution', effectiveDate: '2026-09-01', amount: '700000' },
    ];
    const deletion = prepareMovementDeletion({
      movements: ledger,
      movementId: 'replacement-b',
      reason: 'Operación inexistente',
    });
    expect(effectiveMovements(deletion.resultingMovements)).toEqual([]);
  });

  it('rejects neutralized originals, technical reversals, duplicate deletes, and missing reasons', () => {
    const reversal = {
      id: 'reverse-a', type: 'withdrawal', effectiveDate: '2026-09-01',
      amount: '710000', reversesMovementId: 'initial',
    };
    const ledger = [initial, reversal];
    expect(() => prepareMovementDeletion({ movements: ledger, movementId: 'initial', reason: 'x' }))
      .toThrowError(expect.objectContaining({ code: 'MOVEMENT_ALREADY_REVERSED' }));
    expect(() => prepareMovementDeletion({ movements: ledger, movementId: 'reverse-a', reason: 'x' }))
      .toThrowError(expect.objectContaining({ code: 'TECHNICAL_REVERSAL_IMMUTABLE' }));
    expect(() => prepareMovementDeletion({ movements: [initial], movementId: 'initial', reason: ' ' }))
      .toThrowError(expect.objectContaining({ code: 'DELETE_REASON_REQUIRED' }));
  });
});
