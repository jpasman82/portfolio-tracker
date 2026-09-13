import {
  LOAN_CALCULATION_VERSION,
  LOAN_CAPITALIZATION_FREQUENCIES,
  LOAN_CURRENCIES,
  LOAN_MOVEMENT_TYPES,
  LOAN_RATE_TYPES,
} from './loanModel';
import { compareDateOnly, parseDateOnly } from './loanDates';

export const LOAN_STATUSES = Object.freeze({
  ACTIVE: 'active',
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
});

const LOAN_FIELDS = Object.freeze([
  'type',
  'name',
  'currency',
  'startDate',
  'maturityDate',
  'rate',
  'rateType',
  'capitalizationFrequency',
  'calculationVersion',
  'status',
]);
const MOVEMENT_FIELDS = Object.freeze([
  'type',
  'effectiveDate',
  'amount',
  'note',
  'reversesMovementId',
]);
const POSITIVE_DECIMAL_PATTERN = /^([1-9][0-9]*(\.[0-9]+)?|0\.[0-9]*[1-9][0-9]*)$/;
const NON_NEGATIVE_DECIMAL_PATTERN = /^(0|[1-9][0-9]*(\.[0-9]+)?|0\.[0-9]*[1-9][0-9]*)$/;

export class LoanPersistenceValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LoanPersistenceValidationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new LoanPersistenceValidationError(code, message);
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_DOCUMENT', `${label} must be an object`);
  }
}

function assertAllowedKeys(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    fail('UNEXPECTED_FIELD', `${label} contains unsupported fields: ${extras.sort().join(', ')}`);
  }
}

function requireString(value, fieldName, { maxLength, allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    fail('INVALID_STRING', `${fieldName} must be a non-empty string`);
  }
  if (maxLength && value.length > maxLength) {
    fail('INVALID_STRING', `${fieldName} must contain at most ${maxLength} characters`);
  }
  return value;
}

function requireDateOnly(value, fieldName) {
  try {
    parseDateOnly(value, fieldName);
    return value;
  } catch (error) {
    fail('INVALID_DATE_ONLY', error.message);
  }
}

function requireTimestamp(value, fieldName) {
  if (!value || typeof value.toDate !== 'function') {
    fail('INVALID_TIMESTAMP', `${fieldName} must be a Firestore Timestamp`);
  }
  return value;
}

export function requireCanonicalRate(value) {
  if (typeof value !== 'string' || value.length > 100 || !NON_NEGATIVE_DECIMAL_PATTERN.test(value)) {
    fail('INVALID_RATE_DECIMAL', 'rate must be a canonical non-negative decimal string');
  }
  return value;
}

export function requireCanonicalAmount(value) {
  if (typeof value !== 'string' || value.length > 100 || !POSITIVE_DECIMAL_PATTERN.test(value)) {
    fail('INVALID_AMOUNT_DECIMAL', 'amount must be a canonical positive decimal string');
  }
  return value;
}

export function normalizeLoanForPersistence(value) {
  assertRecord(value, 'loan');
  assertAllowedKeys(value, LOAN_FIELDS, 'loan');

  const startDate = requireDateOnly(value.startDate, 'startDate');
  const maturityDate = requireDateOnly(value.maturityDate, 'maturityDate');
  if (compareDateOnly(startDate, maturityDate) >= 0) {
    fail('INVALID_MATURITY_DATE', 'maturityDate must be after startDate');
  }

  if (!LOAN_CURRENCIES.includes(value.currency)) fail('INVALID_CURRENCY', 'Unsupported currency');
  if (!Object.values(LOAN_RATE_TYPES).includes(value.rateType)) {
    fail('INVALID_RATE_TYPE', 'Unsupported rateType');
  }
  if (value.capitalizationFrequency !== LOAN_CAPITALIZATION_FREQUENCIES.MONTHLY) {
    fail('INVALID_CAPITALIZATION_FREQUENCY', 'Only monthly capitalization is supported');
  }
  if (value.calculationVersion !== LOAN_CALCULATION_VERSION) {
    fail('INVALID_CALCULATION_VERSION', `calculationVersion must be ${LOAN_CALCULATION_VERSION}`);
  }
  if (!Object.values(LOAN_STATUSES).includes(value.status)) {
    fail('INVALID_STATUS', 'Unsupported loan status');
  }

  return {
    type: value.type === 'loan' ? value.type : fail('INVALID_ASSET_TYPE', 'type must be loan'),
    name: requireString(value.name, 'name', { maxLength: 120 }),
    currency: value.currency,
    startDate,
    maturityDate,
    rate: requireCanonicalRate(value.rate),
    rateType: value.rateType,
    capitalizationFrequency: value.capitalizationFrequency,
    calculationVersion: value.calculationVersion,
    status: value.status,
  };
}

export function serializeLoanForFirestore(loan, { createdAt, updatedAt }) {
  if (!createdAt || !updatedAt) fail('MISSING_AUDIT_TIMESTAMP', 'Loan audit timestamps are required');
  return { ...normalizeLoanForPersistence(loan), createdAt, updatedAt };
}

export function deserializeLoanFromFirestore(data, { id } = {}) {
  assertRecord(data, 'loan document');
  assertAllowedKeys(data, [...LOAN_FIELDS, 'createdAt', 'updatedAt'], 'loan document');
  const loan = normalizeLoanForPersistence(
    Object.fromEntries(LOAN_FIELDS.map((field) => [field, data[field]]))
  );
  return {
    ...(id === undefined ? {} : { id }),
    ...loan,
    createdAt: requireTimestamp(data.createdAt, 'createdAt'),
    updatedAt: requireTimestamp(data.updatedAt, 'updatedAt'),
  };
}

export function normalizeMovementForPersistence(value) {
  assertRecord(value, 'movement');
  assertAllowedKeys(value, MOVEMENT_FIELDS, 'movement');
  if (!Object.values(LOAN_MOVEMENT_TYPES).includes(value.type)) {
    fail('INVALID_MOVEMENT_TYPE', 'Unsupported movement type');
  }

  const movement = {
    type: value.type,
    effectiveDate: requireDateOnly(value.effectiveDate, 'effectiveDate'),
    amount: requireCanonicalAmount(value.amount),
  };
  if (value.note !== undefined) {
    movement.note = requireString(value.note, 'note', { maxLength: 500, allowEmpty: true });
  }
  if (value.reversesMovementId !== undefined) {
    movement.reversesMovementId = requireString(
      value.reversesMovementId,
      'reversesMovementId',
      { maxLength: 128 }
    );
  }
  return movement;
}

export function serializeMovementForFirestore(movement, { createdAt }) {
  if (!createdAt) fail('MISSING_AUDIT_TIMESTAMP', 'Movement createdAt is required');
  return { ...normalizeMovementForPersistence(movement), createdAt };
}

export function deserializeMovementFromFirestore(data, { id } = {}) {
  assertRecord(data, 'movement document');
  assertAllowedKeys(data, [...MOVEMENT_FIELDS, 'createdAt'], 'movement document');
  const movementData = Object.fromEntries(
    MOVEMENT_FIELDS.filter((field) => data[field] !== undefined).map((field) => [field, data[field]])
  );
  return {
    ...(id === undefined ? {} : { id }),
    ...normalizeMovementForPersistence(movementData),
    createdAt: requireTimestamp(data.createdAt, 'createdAt'),
  };
}

export function toLoanEngineDefinition(loanDocument) {
  const loan = normalizeLoanForPersistence(
    Object.fromEntries(LOAN_FIELDS.map((field) => [field, loanDocument[field]]))
  );
  return {
    name: loan.name,
    currency: loan.currency,
    startDate: loan.startDate,
    maturityDate: loan.maturityDate,
    rate: loan.rate,
    rateType: loan.rateType,
    capitalizationFrequency: loan.capitalizationFrequency,
    calculationVersion: loan.calculationVersion,
  };
}

export function toLoanEngineMovement(movementDocument) {
  const movement = normalizeMovementForPersistence(
    Object.fromEntries(
      MOVEMENT_FIELDS.filter((field) => movementDocument[field] !== undefined)
        .map((field) => [field, movementDocument[field]])
    )
  );
  return {
    effectiveDate: movement.effectiveDate,
    type: movement.type,
    amount: movement.amount,
  };
}

export function normalizeLoanMetadataUpdate(value, updatedAt) {
  assertRecord(value, 'loan update');
  assertAllowedKeys(value, ['name', 'status'], 'loan update');
  if (Object.keys(value).length === 0) fail('EMPTY_UPDATE', 'Loan update cannot be empty');
  if (!updatedAt) fail('MISSING_AUDIT_TIMESTAMP', 'Loan updatedAt is required');

  const update = { updatedAt };
  if (value.name !== undefined) update.name = requireString(value.name, 'name', { maxLength: 120 });
  if (value.status !== undefined) {
    if (!Object.values(LOAN_STATUSES).includes(value.status)) {
      fail('INVALID_STATUS', 'Unsupported loan status');
    }
    update.status = value.status;
  }
  return update;
}
