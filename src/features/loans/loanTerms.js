import { calculateLoanAtDate, projectLoanToMaturity } from './loanEngine';
import { compareDateOnly } from './loanDates';
import { effectiveMovements, validateCompleteLoanLedger } from './loanMovements';
import {
  normalizeLoanForPersistence,
  toLoanEngineDefinition,
  toLoanEngineMovement,
} from './loanSerialization';

export const LOAN_TERMS_CHANGE_KINDS = Object.freeze({
  CORRECTION: 'correction',
  MATURITY_EXTENSION: 'maturity_extension',
});

const CORRECTION_FIELDS = Object.freeze([
  'name',
  'startDate',
  'maturityDate',
  'rate',
  'rateType',
]);
const EXTENSION_FIELDS = Object.freeze(['maturityDate']);
const CONTRACT_SNAPSHOT_FIELDS = Object.freeze([
  'name',
  'currency',
  'startDate',
  'maturityDate',
  'rate',
  'rateType',
  'capitalizationFrequency',
  'calculationVersion',
]);

export class LoanTermsChangeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LoanTermsChangeError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new LoanTermsChangeError(code, message);
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_TERMS_CHANGE', `${label} must be an object`);
  }
}

export function loanContractSnapshot(loan) {
  return Object.fromEntries(CONTRACT_SNAPSHOT_FIELDS.map((field) => [field, loan[field]]));
}

function persistenceLoan(loan, changes = {}) {
  return normalizeLoanForPersistence({
    type: loan.type,
    name: loan.name,
    currency: loan.currency,
    startDate: loan.startDate,
    maturityDate: loan.maturityDate,
    rate: loan.rate,
    rateType: loan.rateType,
    capitalizationFrequency: loan.capitalizationFrequency,
    calculationVersion: loan.calculationVersion,
    status: loan.status,
    ...changes,
  });
}

export function buildLoanTermsCandidate({ loan, kind, changes }) {
  assertRecord(loan, 'loan');
  assertRecord(changes, 'changes');
  if (loan.status !== 'active') {
    fail('LOAN_STATUS_NOT_ACTIVE', `Loan terms cannot change with status ${String(loan.status)}`);
  }

  const allowedFields = kind === LOAN_TERMS_CHANGE_KINDS.CORRECTION
    ? CORRECTION_FIELDS
    : kind === LOAN_TERMS_CHANGE_KINDS.MATURITY_EXTENSION
      ? EXTENSION_FIELDS
      : fail('INVALID_TERMS_CHANGE_KIND', `Unsupported loan terms change kind: ${String(kind)}`);
  const fields = Object.keys(changes);
  const unsupported = fields.filter((field) => !allowedFields.includes(field));
  if (unsupported.length > 0) {
    fail(
      'UNSUPPORTED_TERMS_FIELD',
      `${kind} contains unsupported fields: ${unsupported.sort().join(', ')}`,
    );
  }
  if (fields.length === 0) fail('EMPTY_TERMS_CHANGE', 'At least one term must change');

  const candidate = persistenceLoan(loan, changes);
  const before = loanContractSnapshot(loan);
  const after = loanContractSnapshot(candidate);
  if (CONTRACT_SNAPSHOT_FIELDS.every((field) => before[field] === after[field])) {
    fail('EMPTY_TERMS_CHANGE', 'At least one term must change');
  }

  if (
    kind === LOAN_TERMS_CHANGE_KINDS.MATURITY_EXTENSION
    && compareDateOnly(candidate.maturityDate, loan.maturityDate) <= 0
  ) {
    fail(
      'INVALID_MATURITY_EXTENSION',
      'A maturity extension must be later than the current maturityDate',
    );
  }

  return candidate;
}

/**
 * Pure L1-backed preview shared by repository preview and transactional apply.
 */
export function calculateLoanTermsChangePreview({ loan, movements, kind, changes, asOfDate }) {
  const candidateLoan = buildLoanTermsCandidate({ loan, kind, changes });
  const currentEngineLoan = toLoanEngineDefinition(loan);
  const proposedEngineLoan = toLoanEngineDefinition(candidateLoan);
  const engineMovements = effectiveMovements(movements).map(toLoanEngineMovement);

  validateCompleteLoanLedger({ loan, movements });
  validateCompleteLoanLedger({ loan: candidateLoan, movements });

  const currentValue = calculateLoanAtDate({
    loan: currentEngineLoan,
    movements: engineMovements,
    asOfDate,
  });
  const proposedValue = calculateLoanAtDate({
    loan: proposedEngineLoan,
    movements: engineMovements,
    asOfDate,
  });
  const currentProjection = projectLoanToMaturity({
    loan: currentEngineLoan,
    movements: engineMovements,
    asOfDate,
  });
  const proposedProjection = projectLoanToMaturity({
    loan: proposedEngineLoan,
    movements: engineMovements,
    asOfDate,
  });
  const continuesAccrualAfterOriginalMaturity =
    kind === LOAN_TERMS_CHANGE_KINDS.MATURITY_EXTENSION
    && compareDateOnly(asOfDate, loan.maturityDate) >= 0;

  return {
    kind,
    currentTerms: loanContractSnapshot(loan),
    proposedTerms: loanContractSnapshot(candidateLoan),
    currentValue,
    proposedValue,
    currentProjection,
    proposedProjection,
    warnings: continuesAccrualAfterOriginalMaturity
      ? [{
          code: 'ACCRUAL_CONTINUES_AFTER_ORIGINAL_MATURITY',
          message: 'Interest continues under the existing rate from the original maturity to the new maturity.',
        }]
      : [],
    continuesAccrualAfterOriginalMaturity,
    candidateLoan,
  };
}
