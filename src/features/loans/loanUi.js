import Decimal from 'decimal.js';
import { compareDateOnly, parseDateOnly, toDateOnly } from './loanDates';
import {
  normalizeLoanForPersistence,
  toLoanEngineDefinition,
  toLoanEngineMovement,
} from './loanSerialization';
import { calculateLoanAtDate } from './loanEngine';
import {
  effectiveMovements,
  prepareMovementCorrection,
  prepareMovementDeletion,
} from './loanMovements';
import { buildLoanTimeline } from './loanTimeline';

const RATE_TYPE_LABELS = Object.freeze({
  monthly_effective: 'Mensual',
  annual_effective: 'Anual efectiva',
});

const STATUS_LABELS = Object.freeze({
  active: 'Activo',
  matured: 'Vencido',
  closed: 'Cerrado',
  cancelled: 'Cancelado',
});

export class LoanFormValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'LoanFormValidationError';
    this.field = field;
  }
}

function formError(field, message) {
  throw new LoanFormValidationError(field, message);
}

function normalizeHumanDecimal(value, field, { amount = false } = {}) {
  if (typeof value !== 'string') formError(field, 'Ingresá un valor válido.');

  let normalized = value
    .trim()
    .replace(/\s|\u00a0/g, '')
    .replace(/^(USD|ARS|US\$|\$)/i, '');

  if (!normalized || !/^\d+(?:[.,]\d+)*$/.test(normalized)) {
    formError(field, 'Ingresá un valor válido.');
  }

  const commaCount = (normalized.match(/,/g) || []).length;
  const dotCount = (normalized.match(/\./g) || []).length;

  if (commaCount > 0 && dotCount > 0) {
    if (normalized.lastIndexOf(',') < normalized.lastIndexOf('.')) {
      formError(field, 'Usá punto para miles y coma para decimales.');
    }
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (commaCount > 0) {
    if (commaCount > 1) formError(field, 'Ingresá un valor válido.');
    normalized = normalized.replace(',', '.');
  } else if (dotCount > 0 && amount) {
    const groupedInteger = /^\d{1,3}(?:\.\d{3})+$/.test(normalized);
    if (groupedInteger) normalized = normalized.replace(/\./g, '');
    else if (dotCount > 1) formError(field, 'Ingresá un valor válido.');
  } else if (dotCount > 1) {
    formError(field, 'Ingresá un valor válido.');
  }

  try {
    return new Decimal(normalized);
  } catch {
    formError(field, 'Ingresá un valor válido.');
  }
}

export function humanPercentToRate(value) {
  const percentage = normalizeHumanDecimal(value, 'rate');
  if (percentage.isNegative()) formError('rate', 'La tasa no puede ser negativa.');
  return percentage.div(100).toString();
}

export function humanAmountToCanonical(value, field = 'initialAmount') {
  const amount = normalizeHumanDecimal(value, field, { amount: true });
  if (amount.lessThanOrEqualTo(0)) formError(field, 'El monto debe ser mayor que cero.');
  return amount.toString();
}

export function canonicalAmountToHuman(value) {
  return new Decimal(value).toString().replace('.', ',');
}

export function formatRatePercent(rate) {
  return `${new Decimal(rate).times(100).toString().replace('.', ',')} %`;
}

export function formatMoney(currency, value) {
  const fixed = new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
  const [whole, decimals] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = decimals === '00' ? '' : `,${decimals}`;
  return `${currency} ${grouped}${fraction}`;
}

export function formatDateOnly(value) {
  if (!value) return '—';
  const { year, month, day } = parseDateOnly(value);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

export function todayDateOnly(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('A valid Date is required');
  }
  return toDateOnly({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  });
}

export function rateTypeLabel(rateType) {
  return RATE_TYPE_LABELS[rateType] || rateType;
}

export function movementTypeLabel(type) {
  return type === 'contribution' ? 'Ingreso' : type === 'withdrawal' ? 'Retiro' : type;
}

export function effectiveLoanStatus(loan, asOfDate) {
  if (loan.status === 'closed' || loan.status === 'cancelled') return loan.status;
  return compareDateOnly(asOfDate, loan.maturityDate) >= 0 ? 'matured' : 'active';
}

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

export function deriveLoanPresentation({ loan, movements, asOfDate }) {
  const engineLoan = toLoanEngineDefinition(loan);
  const visibleMovements = effectiveMovements(movements);
  const timeline = buildLoanTimeline({ loan: engineLoan, movements, asOfDate });
  const effectiveStatus = effectiveLoanStatus(loan, asOfDate);

  return {
    loan,
    movements,
    visibleMovements,
    asOfDate,
    valuation: timeline.currentValuation,
    projection: timeline.projection,
    timeline,
    effectiveStatus,
  };
}

export function movementFormValues({ loan, movement, now = new Date() }) {
  let effectiveDate = todayDateOnly(now);
  if (compareDateOnly(effectiveDate, loan.startDate) < 0) effectiveDate = loan.startDate;
  if (compareDateOnly(effectiveDate, loan.maturityDate) > 0) effectiveDate = loan.maturityDate;

  return {
    type: movement?.type || 'contribution',
    effectiveDate: movement?.effectiveDate || effectiveDate,
    amount: movement ? canonicalAmountToHuman(movement.amount) : '',
    note: movement?.note || '',
  };
}

export function buildMovementInput(form, loan) {
  if (!['contribution', 'withdrawal'].includes(form?.type)) {
    formError('type', 'Elegí Ingreso o Retiro.');
  }

  try {
    parseDateOnly(form.effectiveDate, 'effectiveDate');
  } catch {
    formError('effectiveDate', 'Ingresá una fecha válida.');
  }
  if (
    compareDateOnly(form.effectiveDate, loan.startDate) < 0 ||
    compareDateOnly(form.effectiveDate, loan.maturityDate) > 0
  ) {
    formError('effectiveDate', 'La fecha debe estar dentro de la vigencia del préstamo.');
  }

  const amount = humanAmountToCanonical(form.amount, 'amount');
  const note = typeof form.note === 'string' ? form.note.trim() : '';
  if (note.length > 500) formError('note', 'La nota puede tener hasta 500 caracteres.');
  return {
    type: form.type,
    effectiveDate: form.effectiveDate,
    amount,
    ...(note ? { note } : {}),
  };
}

/**
 * Valuation the loan would show at `asOfDate` once `form` is saved, so the
 * movement sheet can confirm the outcome before writing.
 *
 * No new arithmetic: it assembles exactly the ledger the repository will
 * persist — an appended movement when adding, and the reversal + replacement
 * pair from `prepareMovementCorrection` when editing — and hands it to L1.
 * Throws `LoanFormValidationError` while the form is still incomplete, which
 * callers treat as "nothing to preview yet".
 */
export function previewLoanValueAfterMovement({
  loan,
  movements,
  asOfDate,
  movementId,
  form,
}) {
  const candidate = buildMovementInput(form, loan);
  const resultingMovements = movementId
    ? prepareMovementCorrection({ movements, movementId, correctedData: candidate })
      .resultingMovements
    : [...movements, candidate];

  return valueOfLedger({ loan, movements: resultingMovements, asOfDate });
}

/**
 * Valuation the loan would show at `asOfDate` once the movement is deleted,
 * so the confirmation can state the effect instead of only describing it.
 * Uses the same reversal the repository writes.
 */
export function previewLoanValueAfterMovementDeletion({
  loan,
  movements,
  asOfDate,
  movementId,
}) {
  const { resultingMovements } = prepareMovementDeletion({
    movements,
    movementId,
    // The reason is stored as the reversal's note and never reaches the engine.
    // The preview supplies a placeholder so it can run before one is typed.
    reason: 'preview',
  });
  return valueOfLedger({ loan, movements: resultingMovements, asOfDate });
}

function valueOfLedger({ loan, movements, asOfDate }) {
  return calculateLoanAtDate({
    loan: toLoanEngineDefinition(loan),
    movements: effectiveMovements(movements).map(toLoanEngineMovement),
    asOfDate,
  });
}

export async function submitLoanMovement({
  uid,
  loanId,
  loan,
  movementId,
  form,
  repository,
}) {
  if (!uid) formError('auth', 'La sesión no está disponible. Volvé a ingresar.');
  if (!loanId) formError('loan', 'No pudimos identificar el préstamo.');
  const movement = buildMovementInput(form, loan);

  if (movementId) {
    return repository.correctMovement(uid, loanId, movementId, movement);
  }
  return repository.addMovement(uid, loanId, movement);
}

export function movementSaveErrorMessage(error) {
  if (error instanceof LoanFormValidationError) return error.message;
  if (error?.code === 'WITHDRAWAL_EXCEEDS_AVAILABLE_VALUE') {
    return 'El retiro supera el valor disponible en alguna fecha del préstamo.';
  }
  if (error?.code === 'MOVEMENT_NOT_FOUND') {
    return 'El movimiento ya no está disponible. Actualizá la página e intentá nuevamente.';
  }
  if (error?.code === 'TECHNICAL_REVERSAL_IMMUTABLE') {
    return 'Este movimiento forma parte del historial de auditoría y no puede editarse.';
  }
  if (error?.code === 'MOVEMENT_ALREADY_REVERSED') {
    return 'El movimiento ya fue corregido. Actualizá la página para ver la versión vigente.';
  }
  if (error?.code === 'MISSING_CONTRIBUTION') {
    return 'El préstamo debe conservar al menos un ingreso.';
  }
  if (/status (closed|cancelled)/i.test(error?.message || '')) {
    return 'El préstamo está cerrado o cancelado y no admite nuevos movimientos.';
  }
  return 'No pudimos guardar el movimiento. Revisá los datos e intentá nuevamente.';
}

export async function submitLoanMovementDeletion({
  uid,
  loanId,
  movementId,
  reason,
  repository,
}) {
  if (!uid) formError('auth', 'La sesión no está disponible. Volvé a ingresar.');
  if (!loanId || !movementId) formError('movement', 'No pudimos identificar el movimiento.');
  if (typeof reason !== 'string' || reason.trim() === '') {
    formError('reason', 'Ingresá el motivo de la eliminación.');
  }
  if (reason.trim().length > 500) {
    formError('reason', 'El motivo puede tener hasta 500 caracteres.');
  }
  return repository.deleteMovement(uid, loanId, movementId, reason.trim());
}

export function movementDeleteErrorMessage(error) {
  if (error instanceof LoanFormValidationError) return error.message;
  if (error?.code === 'WITHDRAWAL_EXCEEDS_AVAILABLE_VALUE') {
    return 'No se puede eliminar: un retiro posterior quedaría sin saldo suficiente.';
  }
  if (error?.code === 'CONTRIBUTION_REQUIRED' || error?.code === 'MISSING_CONTRIBUTION') {
    return 'El préstamo debe conservar al menos un ingreso.';
  }
  if (error?.code === 'MOVEMENT_ALREADY_REVERSED') {
    return 'El movimiento ya fue eliminado o corregido. Actualizá la página.';
  }
  if (error?.code === 'TECHNICAL_REVERSAL_IMMUTABLE') {
    return 'El movimiento técnico de auditoría no puede eliminarse.';
  }
  if (error?.code === 'MOVEMENT_NOT_FOUND') {
    return 'El movimiento ya no existe. Actualizá la página.';
  }
  if (/status (closed|cancelled)/i.test(error?.message || '')) {
    return 'El préstamo está cerrado o cancelado y no admite cambios.';
  }
  return 'No pudimos eliminar el movimiento. Actualizá la página e intentá nuevamente.';
}

export function loanTermsFormValues(loan) {
  return {
    name: loan.name,
    startDate: loan.startDate,
    maturityDate: loan.maturityDate,
    rateType: loan.rateType,
    rate: new Decimal(loan.rate).times(100).toString().replace('.', ','),
    newMaturityDate: loan.maturityDate,
    reason: '',
  };
}

export function buildLoanTermsChangeInput({ loan, mode, form, asOfDate }) {
  if (!['correction', 'maturity_extension'].includes(mode)) {
    formError('mode', 'Elegí el tipo de cambio.');
  }
  const reason = typeof form?.reason === 'string' ? form.reason.trim() : '';
  if (!reason) formError('reason', 'Ingresá el motivo del cambio.');
  if (reason.length > 1000) formError('reason', 'El motivo puede tener hasta 1000 caracteres.');

  let changes;
  if (mode === 'maturity_extension') {
    try {
      parseDateOnly(form.newMaturityDate, 'newMaturityDate');
    } catch {
      formError('newMaturityDate', 'Ingresá una fecha de vencimiento válida.');
    }
    if (compareDateOnly(form.newMaturityDate, loan.maturityDate) <= 0) {
      formError('newMaturityDate', 'El nuevo vencimiento debe ser posterior al actual.');
    }
    changes = { maturityDate: form.newMaturityDate };
  } else {
    const name = typeof form.name === 'string' ? form.name.trim() : '';
    if (!name) formError('name', 'Ingresá un nombre.');
    for (const field of ['startDate', 'maturityDate']) {
      try {
        parseDateOnly(form[field], field);
      } catch {
        formError(field, 'Ingresá una fecha válida.');
      }
    }
    if (compareDateOnly(form.maturityDate, form.startDate) <= 0) {
      formError('maturityDate', 'El vencimiento debe ser posterior a la fecha inicial.');
    }
    if (!Object.hasOwn(RATE_TYPE_LABELS, form.rateType)) {
      formError('rateType', 'Elegí un tipo de tasa.');
    }
    const proposed = {
      name,
      startDate: form.startDate,
      maturityDate: form.maturityDate,
      rateType: form.rateType,
      rate: humanPercentToRate(form.rate),
    };
    changes = Object.fromEntries(
      Object.entries(proposed).filter(([field, value]) => value !== loan[field]),
    );
    if (Object.keys(changes).length === 0) formError('form', 'No hay cambios para previsualizar.');
  }

  return { kind: mode, changes, asOfDate, reason };
}

export function loanTermsErrorMessage(error) {
  if (error instanceof LoanFormValidationError) return error.message;
  if (error?.code === 'STALE_LOAN_TERMS_REVISION') {
    return 'Las condiciones cambiaron en otra sesión. Actualizá el préstamo y volvé a intentarlo.';
  }
  if (error?.code === 'MOVEMENT_AFTER_MATURITY') {
    return 'El nuevo vencimiento dejaría movimientos fuera de la vigencia del préstamo.';
  }
  if (
    error?.code === 'MOVEMENT_BEFORE_START_DATE'
    || error?.code === 'MOVEMENT_BEFORE_START'
  ) {
    return 'Hay movimientos anteriores a la nueva fecha inicial. Corregilos o anulalos antes de cambiar la fecha.';
  }
  if (error?.code === 'WITHDRAWAL_EXCEEDS_AVAILABLE_VALUE') {
    return 'El cambio dejaría el historial del préstamo sin saldo suficiente.';
  }
  if (error?.code === 'LOAN_STATUS_NOT_ACTIVE') {
    return 'El préstamo está cerrado o cancelado y no admite cambios.';
  }
  if (error?.code === 'MISSING_CONTRIBUTION') {
    return 'El préstamo debe conservar al menos un ingreso.';
  }
  if (error?.code === 'INVALID_RATE' || error?.code === 'INVALID_RATE_DECIMAL') {
    return 'Ingresá una tasa válida.';
  }
  if (error?.code === 'INVALID_DATE' || error?.code === 'INVALID_DATE_ONLY') {
    return 'Ingresá fechas válidas.';
  }
  return 'No pudimos procesar el cambio. Revisá los datos e intentá nuevamente.';
}

export function buildLoanCreationInput(form) {
  const name = typeof form?.name === 'string' ? form.name.trim() : '';
  if (!name) formError('name', 'Ingresá un nombre.');

  if (!['USD', 'ARS'].includes(form.currency)) {
    formError('currency', 'Elegí una moneda.');
  }

  try {
    parseDateOnly(form.startDate, 'startDate');
  } catch {
    formError('startDate', 'Ingresá una fecha inicial válida.');
  }
  try {
    parseDateOnly(form.maturityDate, 'maturityDate');
  } catch {
    formError('maturityDate', 'Ingresá una fecha de vencimiento válida.');
  }
  if (compareDateOnly(form.maturityDate, form.startDate) <= 0) {
    formError('maturityDate', 'El vencimiento debe ser posterior a la fecha inicial.');
  }

  if (!Object.hasOwn(RATE_TYPE_LABELS, form.rateType)) {
    formError('rateType', 'Elegí un tipo de tasa.');
  }

  const rate = humanPercentToRate(form.rate);
  const amount = humanAmountToCanonical(form.initialAmount);
  const loan = normalizeLoanForPersistence({
    type: 'loan',
    name,
    currency: form.currency,
    startDate: form.startDate,
    maturityDate: form.maturityDate,
    rate,
    rateType: form.rateType,
    capitalizationFrequency: 'monthly',
    calculationVersion: 'loan-v1',
    status: 'active',
  });

  return { loan, initialContribution: { amount } };
}

export async function submitLoanCreation({ uid, form, repository }) {
  if (!uid) formError('auth', 'La sesión no está disponible. Volvé a ingresar.');
  const { loan, initialContribution } = buildLoanCreationInput(form);
  return repository.createLoan(uid, loan, initialContribution);
}

export async function loadLoanCards({ uid, repository, asOfDate }) {
  if (!uid) return [];
  const loans = await repository.listLoans(uid);
  return Promise.all(
    loans.map(async (loan) => {
      const movements = await repository.listMovements(uid, loan.id);
      return deriveLoanPresentation({ loan, movements, asOfDate });
    }),
  );
}

export async function loadLoanDetail({ uid, loanId, repository, asOfDate }) {
  if (!uid) return null;
  const loan = await repository.getLoan(uid, loanId);
  if (!loan) return null;
  const movements = await repository.listMovements(uid, loanId);
  return deriveLoanPresentation({ loan, movements, asOfDate });
}
