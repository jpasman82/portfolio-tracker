import Decimal from 'decimal.js';
import {
  LOAN_MOVEMENT_TYPES,
  LOAN_RATE_TYPES,
  LoanValidationError,
  normalizeLoanInputs,
} from './loanModel';
import {
  addMonthsAnchored,
  compareDateOnly,
  daysBetween,
  minDateOnly,
  parseDateOnly,
} from './loanDates';

export const LOAN_DECIMAL_PRECISION = 40;

const LoanDecimal = Decimal.clone({
  precision: LOAN_DECIMAL_PRECISION,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -100,
  toExpPos: 100,
});

const ZERO = new LoanDecimal(0);
const ONE = new LoanDecimal(1);

function asDecimal(value) {
  return new LoanDecimal(value);
}

function decimalString(value) {
  return value.isZero() ? '0' : value.toString();
}

function monthlyEffectiveRate(loan) {
  const quotedRate = asDecimal(loan.rate);
  if (loan.rateType === LOAN_RATE_TYPES.MONTHLY_EFFECTIVE) return quotedRate;
  if (loan.rateType === LOAN_RATE_TYPES.ANNUAL_EFFECTIVE) {
    return ONE.plus(quotedRate).pow(ONE.div(12)).minus(ONE);
  }
  throw new LoanValidationError('INVALID_RATE_TYPE', `Unsupported rateType: ${loan.rateType}`);
}

function interestForTranches({ tranches, throughDate, periodEnd, periodicRate }) {
  if (periodicRate.isZero() || tranches.length === 0) return ZERO;

  const periodDays = daysBetween(tranches[0].periodStart, periodEnd);
  return tranches.reduce((total, tranche) => {
    const elapsedDays = daysBetween(tranche.effectiveDate, throughDate);
    if (elapsedDays === 0 || tranche.amount.isZero()) return total;

    const exponent = asDecimal(elapsedDays).div(periodDays);
    const factor = ONE.plus(periodicRate).pow(exponent);
    return total.plus(tranche.amount.times(factor.minus(ONE)));
  }, ZERO);
}

function zeroValuation({ loan, asOfDate }) {
  const firstCapitalization = addMonthsAnchored(loan.startDate, 1, parseDateOnly(loan.startDate).day);
  return {
    asOfDate,
    valuationDate: asOfDate,
    currency: loan.currency,
    netCashFlow: '0',
    capitalizedBalance: '0',
    accruedInterest: '0',
    totalInterestGenerated: '0',
    value: '0',
    lastCapitalizationDate: null,
    nextCapitalizationDate: firstCapitalization <= loan.maturityDate ? firstCapitalization : null,
    matured: false,
  };
}

function calculateNormalizedLoanAtDate({ loan, movements, asOfDate }) {
  if (compareDateOnly(asOfDate, loan.startDate) < 0) {
    return zeroValuation({ loan, asOfDate });
  }

  const matured = compareDateOnly(asOfDate, loan.maturityDate) >= 0;
  const valuationDate = minDateOnly(asOfDate, loan.maturityDate);
  const activeMovements = movements.filter((movement) => movement.effectiveDate <= valuationDate);
  const anchorDay = parseDateOnly(loan.startDate).day;
  const periodicRate = monthlyEffectiveRate(loan);

  let periodIndex = 1;
  let periodStart = loan.startDate;
  let periodEnd = addMonthsAnchored(loan.startDate, periodIndex, anchorDay);
  let movementIndex = 0;
  let capitalizedBalance = ZERO;
  let netCashFlow = ZERO;
  let accruedInterestWithdrawn = ZERO;
  let tranches = [];
  let lastCapitalizationDate = null;

  const grossAccruedAt = (date) => interestForTranches({
    tranches,
    throughDate: date,
    periodEnd,
    periodicRate,
  });

  const applyMovement = (movement) => {
    const amount = asDecimal(movement.amount);
    if (movement.type === LOAN_MOVEMENT_TYPES.CONTRIBUTION) {
      capitalizedBalance = capitalizedBalance.plus(amount);
      netCashFlow = netCashFlow.plus(amount);
      tranches.push({
        amount,
        effectiveDate: movement.effectiveDate,
        periodStart,
      });
      return;
    }

    const grossAccrued = grossAccruedAt(movement.effectiveDate);
    const accruedAvailable = grossAccrued.minus(accruedInterestWithdrawn);
    const totalAvailable = capitalizedBalance.plus(accruedAvailable);
    if (amount.greaterThan(totalAvailable)) {
      throw new LoanValidationError(
        'WITHDRAWAL_EXCEEDS_AVAILABLE_VALUE',
        `Withdrawal on ${movement.effectiveDate} exceeds the available loan value`
      );
    }

    const interestWithdrawal = LoanDecimal.min(amount, accruedAvailable);
    const principalWithdrawal = amount.minus(interestWithdrawal);
    accruedInterestWithdrawn = accruedInterestWithdrawn.plus(interestWithdrawal);
    netCashFlow = netCashFlow.minus(amount);

    if (principalWithdrawal.greaterThan(0)) {
      capitalizedBalance = capitalizedBalance.minus(principalWithdrawal);
      tranches.push({
        amount: principalWithdrawal.negated(),
        effectiveDate: movement.effectiveDate,
        periodStart,
      });
    }
  };

  const applyMovementsOn = (date) => {
    while (
      movementIndex < activeMovements.length &&
      activeMovements[movementIndex].effectiveDate === date
    ) {
      applyMovement(activeMovements[movementIndex]);
      movementIndex += 1;
    }
  };

  const buildResult = () => {
    const grossAccrued = grossAccruedAt(valuationDate);
    const accruedInterest = grossAccrued.minus(accruedInterestWithdrawn);
    const value = capitalizedBalance.plus(accruedInterest);
    const totalInterestGenerated = value.minus(netCashFlow);
    const nextCapitalizationDate = !matured && periodEnd <= loan.maturityDate
      ? periodEnd
      : null;

    return {
      asOfDate,
      valuationDate,
      currency: loan.currency,
      netCashFlow: decimalString(netCashFlow),
      capitalizedBalance: decimalString(capitalizedBalance),
      accruedInterest: decimalString(accruedInterest),
      totalInterestGenerated: decimalString(totalInterestGenerated),
      value: decimalString(value),
      lastCapitalizationDate,
      nextCapitalizationDate,
      matured,
    };
  };

  while (true) {
    applyMovementsOn(periodStart);

    if (valuationDate === periodStart) return buildResult();

    const stopDate = minDateOnly(periodEnd, loan.maturityDate, valuationDate);

    while (
      movementIndex < activeMovements.length &&
      activeMovements[movementIndex].effectiveDate > periodStart &&
      activeMovements[movementIndex].effectiveDate < stopDate
    ) {
      const movementDate = activeMovements[movementIndex].effectiveDate;
      applyMovementsOn(movementDate);
    }

    if (stopDate === periodEnd) {
      const grossAccrued = grossAccruedAt(periodEnd);
      const accruedInterest = grossAccrued.minus(accruedInterestWithdrawn);
      capitalizedBalance = capitalizedBalance.plus(accruedInterest);
      lastCapitalizationDate = periodEnd;

      periodStart = periodEnd;
      periodIndex += 1;
      periodEnd = addMonthsAnchored(loan.startDate, periodIndex, anchorDay);
      accruedInterestWithdrawn = ZERO;
      tranches = capitalizedBalance.isZero()
        ? []
        : [{ amount: capitalizedBalance, effectiveDate: periodStart, periodStart }];
      continue;
    }

    applyMovementsOn(stopDate);
    return buildResult();
  }
}

/**
 * Calculates a loan using date-only inputs and returns canonical decimal strings.
 * `asOfDate` is the requested date; `valuationDate` is capped at maturity.
 */
export function calculateLoanAtDate(input) {
  return calculateNormalizedLoanAtDate(normalizeLoanInputs(input));
}

/**
 * Projects to maturity using only movements effective on or before `asOfDate`.
 */
export function projectLoanToMaturity(input) {
  const normalized = normalizeLoanInputs(input);
  const current = calculateNormalizedLoanAtDate(normalized);
  const knownThroughDate = minDateOnly(normalized.asOfDate, normalized.loan.maturityDate);
  const knownMovements = normalized.movements.filter(
    (movement) => movement.effectiveDate <= knownThroughDate
  );
  const projected = calculateNormalizedLoanAtDate({
    loan: normalized.loan,
    movements: knownMovements,
    asOfDate: normalized.loan.maturityDate,
  });

  return {
    projectedMaturityValue: projected.value,
    projectedFutureInterest: decimalString(
      asDecimal(projected.value).minus(current.value)
    ),
    maturityDate: normalized.loan.maturityDate,
  };
}
