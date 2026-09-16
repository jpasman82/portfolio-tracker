import { calculateLoanAtDate } from './loanEngine';
import { LOAN_MOVEMENT_TYPES } from './loanModel';
import {
  normalizeMovementForPersistence,
  toLoanEngineDefinition,
  toLoanEngineMovement,
} from './loanSerialization';

export class LoanMovementOperationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LoanMovementOperationError';
    this.code = code;
  }
}

function operationError(code, message) {
  throw new LoanMovementOperationError(code, message);
}

export function oppositeMovementType(type) {
  if (type === LOAN_MOVEMENT_TYPES.CONTRIBUTION) {
    return LOAN_MOVEMENT_TYPES.WITHDRAWAL;
  }
  if (type === LOAN_MOVEMENT_TYPES.WITHDRAWAL) {
    return LOAN_MOVEMENT_TYPES.CONTRIBUTION;
  }
  operationError('INVALID_MOVEMENT_TYPE', `Unsupported movement type: ${String(type)}`);
}

export function validateCompleteLoanLedger({ loan, movements }) {
  const financialMovements = effectiveMovements(movements);
  return calculateLoanAtDate({
    loan: toLoanEngineDefinition(loan),
    movements: financialMovements.map(toLoanEngineMovement),
    asOfDate: loan.maturityDate,
  });
}

export function prepareMovementCorrection({ movements, movementId, correctedData }) {
  const original = movements.find((movement) => movement.id === movementId);
  if (!original) {
    operationError('MOVEMENT_NOT_FOUND', `Movement ${movementId} does not exist`);
  }
  if (original.reversesMovementId) {
    operationError('TECHNICAL_REVERSAL_IMMUTABLE', 'Technical reversal movements cannot be corrected');
  }
  if (movements.some((movement) => movement.reversesMovementId === original.id)) {
    operationError('MOVEMENT_ALREADY_REVERSED', 'The movement has already been corrected');
  }
  if (correctedData?.reversesMovementId !== undefined) {
    operationError('INVALID_CORRECTION', 'A corrected movement cannot be a technical reversal');
  }

  const replacement = normalizeMovementForPersistence(correctedData);
  const reversal = normalizeMovementForPersistence({
    type: oppositeMovementType(original.type),
    effectiveDate: original.effectiveDate,
    amount: original.amount,
    reversesMovementId: original.id,
  });

  return {
    original,
    reversal,
    replacement,
    resultingMovements: [...movements, reversal, replacement],
  };
}

export function validateMovementDeletionLedger({ loan, movements }) {
  const hasEffectiveContribution = effectiveMovements(movements).some(
    (movement) => movement.type === LOAN_MOVEMENT_TYPES.CONTRIBUTION,
  );
  if (!hasEffectiveContribution) {
    operationError(
      'CONTRIBUTION_REQUIRED',
      'The loan must retain at least one effective contribution within its term',
    );
  }
  return validateCompleteLoanLedger({ loan, movements });
}

export function prepareMovementDeletion({ movements, movementId, reason }) {
  const original = movements.find((movement) => movement.id === movementId);
  if (!original) {
    operationError('MOVEMENT_NOT_FOUND', `Movement ${movementId} does not exist`);
  }
  if (original.reversesMovementId) {
    operationError('TECHNICAL_REVERSAL_IMMUTABLE', 'Technical reversal movements cannot be deleted');
  }
  if (movements.some((movement) => movement.reversesMovementId === original.id)) {
    operationError('MOVEMENT_ALREADY_REVERSED', 'The movement has already been neutralized');
  }
  if (typeof reason !== 'string' || reason.trim() === '') {
    operationError('DELETE_REASON_REQUIRED', 'A reason is required to delete a movement');
  }
  if (reason.trim().length > 500) {
    operationError('DELETE_REASON_TOO_LONG', 'The delete reason can contain at most 500 characters');
  }

  const reversal = normalizeMovementForPersistence({
    type: oppositeMovementType(original.type),
    effectiveDate: original.effectiveDate,
    amount: original.amount,
    note: reason.trim(),
    reversesMovementId: original.id,
  });

  return {
    original,
    reversal,
    resultingMovements: [...movements, reversal],
  };
}

export function effectiveMovements(movements) {
  const reversedMovementIds = new Set(
    movements
      .filter((movement) => movement.reversesMovementId)
      .map((movement) => movement.reversesMovementId),
  );

  return movements.filter(
    (movement) => !movement.reversesMovementId && !reversedMovementIds.has(movement.id),
  );
}
