import Decimal from 'decimal.js';
import { calculateLoanAtDate, projectLoanToMaturity } from './loanEngine';
import { compareDateOnly, parseDateOnly, toDateOnly } from './loanDates';
import {
  normalizeLoanForPersistence,
  toLoanEngineDefinition,
  toLoanEngineMovement,
} from './loanSerialization';
import { effectiveMovements } from './loanMovements';

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
  const engineMovements = movements.map(toLoanEngineMovement);
  const valuation = calculateLoanAtDate({ loan: engineLoan, movements: engineMovements, asOfDate });
  const projection = projectLoanToMaturity({ loan: engineLoan, movements: engineMovements, asOfDate });
  const effectiveStatus = effectiveLoanStatus(loan, asOfDate);

  return {
    loan,
    movements,
    visibleMovements: effectiveMovements(movements),
    asOfDate,
    valuation,
    projection,
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
  if (/status (closed|cancelled)/i.test(error?.message || '')) {
    return 'El préstamo está cerrado o cancelado y no admite nuevos movimientos.';
  }
  return 'No pudimos guardar el movimiento. Revisá los datos e intentá nuevamente.';
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
