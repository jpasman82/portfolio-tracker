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
const LOAN_TECHNICAL_FIELDS = Object.freeze(['revision', 'latestTermsChangeId']);
const TERMS_SNAPSHOT_FIELDS = Object.freeze([
  'name',
  'currency',
  'startDate',
  'maturityDate',
  'rate',
  'rateType',
  'capitalizationFrequency',
  'calculationVersion',
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

function requireRevision(value, fieldName = 'revision') {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('INVALID_REVISION', `${fieldName} must be a non-negative safe integer`);
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
  return { ...normalizeLoanForPersistence(loan), revision: 0, createdAt, updatedAt };
}

export function deserializeLoanFromFirestore(data, { id } = {}) {
  assertRecord(data, 'loan document');
  assertAllowedKeys(
    data,
    [...LOAN_FIELDS, ...LOAN_TECHNICAL_FIELDS, 'createdAt', 'updatedAt'],
    'loan document',
  );
  const loan = normalizeLoanForPersistence(
    Object.fromEntries(LOAN_FIELDS.map((field) => [field, data[field]]))
  );
  return {
    ...(id === undefined ? {} : { id }),
    ...loan,
    revision: data.revision === undefined ? 0 : requireRevision(data.revision),
    ...(data.latestTermsChangeId === undefined
      ? {}
      : {
          latestTermsChangeId: requireString(
            data.latestTermsChangeId,
            'latestTermsChangeId',
            { maxLength: 128 },
          ),
        }),
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
  assertAllowedKeys(value, ['status'], 'loan update');
  if (Object.keys(value).length === 0) fail('EMPTY_UPDATE', 'Loan update cannot be empty');
  if (!updatedAt) fail('MISSING_AUDIT_TIMESTAMP', 'Loan updatedAt is required');

  const update = { updatedAt };
  if (value.status !== undefined) {
    if (!Object.values(LOAN_STATUSES).includes(value.status)) {
      fail('INVALID_STATUS', 'Unsupported loan status');
    }
    update.status = value.status;
  }
  return update;
}

function normalizeTermsSnapshot(value, label) {
  assertRecord(value, label);
  assertAllowedKeys(value, TERMS_SNAPSHOT_FIELDS, label);
  const missing = TERMS_SNAPSHOT_FIELDS.filter((field) => value[field] === undefined);
  if (missing.length > 0) fail('INVALID_TERMS_SNAPSHOT', `${label} is missing: ${missing.join(', ')}`);

  const normalized = normalizeLoanForPersistence({
    type: 'loan',
    name: value.name,
    currency: 'USD',
    startDate: value.startDate,
    maturityDate: value.maturityDate,
    rate: value.rate,
    rateType: value.rateType,
    capitalizationFrequency: value.capitalizationFrequency,
    calculationVersion: LOAN_CALCULATION_VERSION,
    status: LOAN_STATUSES.ACTIVE,
  });
  return Object.fromEntries(TERMS_SNAPSHOT_FIELDS.map((field) => [field, normalized[field]]));
}

export function serializeTermsChangeForFirestore(value, { createdAt }) {
  assertRecord(value, 'terms change');
  assertAllowedKeys(
    value,
    ['kind', 'before', 'after', 'reason', 'fromRevision', 'toRevision'],
    'terms change',
  );
  if (!['correction', 'maturity_extension'].includes(value.kind)) {
    fail('INVALID_TERMS_CHANGE_KIND', 'Unsupported terms change kind');
  }
  if (typeof value.reason !== 'string' || value.reason.trim() === '' || value.reason.length > 1000) {
    fail('INVALID_REASON', 'reason must be a non-empty string of at most 1000 characters');
  }
  if (!createdAt) fail('MISSING_AUDIT_TIMESTAMP', 'Terms change createdAt is required');
  const fromRevision = requireRevision(value.fromRevision, 'fromRevision');
  const toRevision = requireRevision(value.toRevision, 'toRevision');
  if (toRevision !== fromRevision + 1) {
    fail('INVALID_REVISION', 'toRevision must increment fromRevision by one');
  }

  return {
    kind: value.kind,
    before: normalizeTermsSnapshot(value.before, 'before'),
    after: normalizeTermsSnapshot(value.after, 'after'),
    reason: value.reason.trim(),
    fromRevision,
    toRevision,
    createdAt,
  };
}

export function deserializeTermsChangeFromFirestore(data, { id } = {}) {
  assertRecord(data, 'terms change document');
  assertAllowedKeys(
    data,
    ['kind', 'before', 'after', 'reason', 'fromRevision', 'toRevision', 'createdAt'],
    'terms change document',
  );
  const { createdAt, ...change } = data;
  const normalized = serializeTermsChangeForFirestore(change, { createdAt });
  requireTimestamp(normalized.createdAt, 'createdAt');
  return { ...(id === undefined ? {} : { id }), ...normalized };
}
