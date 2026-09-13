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
  return calculateLoanAtDate({
    loan: toLoanEngineDefinition(loan),
    movements: movements.map(toLoanEngineMovement),
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
