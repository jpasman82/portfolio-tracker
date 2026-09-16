import Decimal from 'decimal.js';
import { compareDateOnly, parseDateOnly } from './loanDates';

export const LOAN_CALCULATION_VERSION = 'loan-v1';
export const LOAN_RATE_TYPES = Object.freeze({
  MONTHLY_EFFECTIVE: 'monthly_effective',
  ANNUAL_EFFECTIVE: 'annual_effective',
});
export const LOAN_CAPITALIZATION_FREQUENCIES = Object.freeze({
  MONTHLY: 'monthly',
});
export const LOAN_MOVEMENT_TYPES = Object.freeze({
  CONTRIBUTION: 'contribution',
  WITHDRAWAL: 'withdrawal',
});
export const LOAN_CURRENCIES = Object.freeze(['ARS', 'USD']);

export class LoanValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LoanValidationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new LoanValidationError(code, message);
}

function normalizedDecimal(value, fieldName, { allowZero }) {
  let decimal;
  try {
    decimal = new Decimal(value);
  } catch {
    fail('INVALID_DECIMAL', `${fieldName} must be a finite decimal`);
  }

  if (!decimal.isFinite()) fail('INVALID_DECIMAL', `${fieldName} must be a finite decimal`);
  if (decimal.isNegative() || (!allowZero && decimal.isZero())) {
    fail(
      fieldName === 'rate' ? 'INVALID_RATE' : 'INVALID_MOVEMENT_AMOUNT',
      allowZero ? `${fieldName} must be zero or greater` : `${fieldName} must be greater than zero`
    );
  }
  return decimal.toString();
}

function validatedDate(value, fieldName) {
  try {
    parseDateOnly(value, fieldName);
    return value;
  } catch (error) {
    fail('INVALID_DATE', error.message);
  }
}

export function normalizeLoanInputs({ loan, movements, asOfDate }) {
  if (!loan || typeof loan !== 'object' || Array.isArray(loan)) {
    fail('INVALID_LOAN', 'loan must be an object');
  }
  if (!Array.isArray(movements)) {
    fail('INVALID_MOVEMENTS', 'movements must be an array');
  }

  const currency = typeof loan.currency === 'string' ? loan.currency.trim().toUpperCase() : '';
  if (!LOAN_CURRENCIES.includes(currency)) {
    fail('INVALID_CURRENCY', `currency must be one of: ${LOAN_CURRENCIES.join(', ')}`);
  }

  const startDate = validatedDate(loan.startDate, 'startDate');
  const maturityDate = validatedDate(loan.maturityDate, 'maturityDate');
  const normalizedAsOfDate = validatedDate(asOfDate, 'asOfDate');
  if (compareDateOnly(maturityDate, startDate) <= 0) {
    fail('INVALID_MATURITY_DATE', 'maturityDate must be after startDate');
  }

  if (!Object.values(LOAN_RATE_TYPES).includes(loan.rateType)) {
    fail('INVALID_RATE_TYPE', `Unsupported rateType: ${String(loan.rateType)}`);
  }
  if (loan.capitalizationFrequency !== LOAN_CAPITALIZATION_FREQUENCIES.MONTHLY) {
    fail('INVALID_CAPITALIZATION_FREQUENCY', 'Only monthly capitalization is supported in loan-v1');
  }
  if (loan.calculationVersion !== LOAN_CALCULATION_VERSION) {
    fail('INVALID_CALCULATION_VERSION', `calculationVersion must be ${LOAN_CALCULATION_VERSION}`);
  }

  const normalizedLoan = {
    ...loan,
    currency,
    startDate,
    maturityDate,
    rate: normalizedDecimal(loan.rate, 'rate', { allowZero: true }),
    rateType: loan.rateType,
    capitalizationFrequency: loan.capitalizationFrequency,
    calculationVersion: loan.calculationVersion,
  };

  const normalizedMovements = movements.map((movement, index) => {
    if (!movement || typeof movement !== 'object' || Array.isArray(movement)) {
      fail('INVALID_MOVEMENT', `movement at index ${index} must be an object`);
    }
    if (!Object.values(LOAN_MOVEMENT_TYPES).includes(movement.type)) {
      fail('INVALID_MOVEMENT_TYPE', `Unsupported movement type at index ${index}: ${String(movement.type)}`);
    }

    const effectiveDate = validatedDate(movement.effectiveDate, `movements[${index}].effectiveDate`);
    if (compareDateOnly(effectiveDate, startDate) < 0) {
      fail('MOVEMENT_BEFORE_START_DATE', `Movement at index ${index} is before startDate`);
    }
    if (compareDateOnly(effectiveDate, maturityDate) > 0) {
      fail('MOVEMENT_AFTER_MATURITY', `Movement at index ${index} is after maturityDate`);
    }

    return {
      ...movement,
      effectiveDate,
      type: movement.type,
      amount: normalizedDecimal(movement.amount, `movements[${index}].amount`, { allowZero: false }),
      _inputIndex: index,
    };
  });

  normalizedMovements.sort((left, right) => {
    const dateOrder = compareDateOnly(left.effectiveDate, right.effectiveDate);
    if (dateOrder !== 0) return dateOrder;
    return left._inputIndex - right._inputIndex;
  });

  const hasContribution = normalizedMovements.some(
    (movement) => movement.type === LOAN_MOVEMENT_TYPES.CONTRIBUTION
  );
  if (!hasContribution) {
    fail('MISSING_CONTRIBUTION', 'At least one contribution is required within the loan term');
  }

  return {
    loan: normalizedLoan,
    movements: normalizedMovements.map((movement) => {
      const normalizedMovement = { ...movement };
      delete normalizedMovement._inputIndex;
      return normalizedMovement;
    }),
    asOfDate: normalizedAsOfDate,
  };
}
