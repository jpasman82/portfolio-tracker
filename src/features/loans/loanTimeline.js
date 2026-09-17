import Decimal from 'decimal.js';
import { addMonthsAnchored, compareDateOnly, minDateOnly, parseDateOnly } from './loanDates';
import {
  calculateLoanAtDate,
  LOAN_DECIMAL_PRECISION,
  projectLoanAtDate,
  projectLoanToMaturity,
} from './loanEngine';
import { effectiveMovements } from './loanMovements';
import { LOAN_MOVEMENT_TYPES } from './loanModel';

const TimelineDecimal = Decimal.clone({
  precision: LOAN_DECIMAL_PRECISION,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -100,
  toExpPos: 100,
});

const ZERO = new TimelineDecimal(0);

function decimalString(value) {
  return value.isZero() ? '0' : value.toString();
}

function movementValue(movement) {
  const amount = new TimelineDecimal(movement.amount);
  return movement.type === LOAN_MOVEMENT_TYPES.CONTRIBUTION ? amount : amount.negated();
}

function sumMovements(movements) {
  return movements.reduce((total, movement) => total.plus(movementValue(movement)), ZERO);
}

function capitalizationDates(loan) {
  const dates = [];
  const anchorDay = parseDateOnly(loan.startDate).day;

  for (let monthOffset = 1; ; monthOffset += 1) {
    const date = addMonthsAnchored(loan.startDate, monthOffset, anchorDay);
    if (compareDateOnly(date, loan.maturityDate) > 0) break;
    dates.push(date);
    if (date === loan.maturityDate) break;
  }

  return dates;
}

function firstContributionAmount(movements) {
  const firstDate = movements
    .filter((movement) => movement.type === LOAN_MOVEMENT_TYPES.CONTRIBUTION)
    .reduce((earliest, movement) => (
      !earliest || compareDateOnly(movement.effectiveDate, earliest) < 0
        ? movement.effectiveDate
        : earliest
    ), null);
  if (!firstDate) return '0';

  return decimalString(sumMovements(movements.filter(
    (movement) => movement.type === LOAN_MOVEMENT_TYPES.CONTRIBUTION
      && movement.effectiveDate === firstDate,
  )));
}

function eventKinds({ date, loan, capitalizationSet, visibleOnDate, isToday }) {
  const kinds = [];
  if (date === loan.startDate) kinds.push('start');
  if (capitalizationSet.has(date)) kinds.push('capitalization');
  if (visibleOnDate.some((movement) => movement.type === LOAN_MOVEMENT_TYPES.CONTRIBUTION)) {
    kinds.push('contribution');
  }
  if (visibleOnDate.some((movement) => movement.type === LOAN_MOVEMENT_TYPES.WITHDRAWAL)) {
    kinds.push('withdrawal');
  }
  if (isToday) kinds.push('today');
  if (date === loan.maturityDate) kinds.push('maturity');
  return kinds;
}

/**
 * Builds an event-only view of a loan. Financial values always come from L1;
 * this helper only chooses event dates and reconciles consecutive valuations.
 */
export function buildLoanTimeline({ loan, movements, asOfDate }) {
  const inputSnapshot = { loan, movements, asOfDate };
  const currentValuation = calculateLoanAtDate(inputSnapshot);
  const projection = projectLoanToMaturity(inputSnapshot);
  const knownThroughDate = minDateOnly(asOfDate, loan.maturityDate);
  const physicalKnownMovements = movements.filter(
    (movement) => compareDateOnly(movement.effectiveDate, knownThroughDate) <= 0,
  );
  const visibleKnownMovements = effectiveMovements(movements).filter(
    (movement) => compareDateOnly(movement.effectiveDate, knownThroughDate) <= 0,
  );
  const capitalizationSet = new Set(capitalizationDates(loan));
  const eventDates = new Set([loan.startDate, loan.maturityDate, ...capitalizationSet]);

  visibleKnownMovements.forEach((movement) => eventDates.add(movement.effectiveDate));
  if (
    compareDateOnly(asOfDate, loan.startDate) >= 0
    && compareDateOnly(asOfDate, loan.maturityDate) <= 0
  ) {
    eventDates.add(asOfDate);
  }

  const sortedDates = [...eventDates].sort(compareDateOnly);
  let previousClosingValue = ZERO;
  const events = sortedDates.map((date) => {
    const projected = compareDateOnly(date, asOfDate) > 0;
    const calculationMovements = projected ? physicalKnownMovements : movements;
    const valuation = projected
      ? projectLoanAtDate({ loan, movements, asOfDate, projectionDate: date })
      : calculateLoanAtDate({ loan, movements, asOfDate: date });
    const physicalOnDate = calculationMovements.filter(
      (movement) => movement.effectiveDate === date,
    );
    const visibleOnDate = visibleKnownMovements.filter(
      (movement) => movement.effectiveDate === date,
    );
    const physicalMovementAmount = sumMovements(physicalOnDate);
    const movementAmount = sumMovements(visibleOnDate);
    const closingValue = new TimelineDecimal(valuation.value);
    const interestForInterval = closingValue
      .minus(previousClosingValue)
      .minus(physicalMovementAmount);
    const isToday = date === asOfDate;
    const event = {
      date,
      kind: date === loan.maturityDate ? 'maturity'
        : isToday ? 'today'
          : capitalizationSet.has(date) ? 'capitalization'
            : date === loan.startDate ? 'start'
              : 'movement',
      kinds: eventKinds({ date, loan, capitalizationSet, visibleOnDate, isToday }),
      openingValue: decimalString(previousClosingValue),
      interestForInterval: decimalString(interestForInterval),
      movementAmount: decimalString(movementAmount),
      closingValue: decimalString(closingValue),
      phase: projected ? 'projected' : 'actual',
      movements: visibleOnDate.map((movement) => ({ ...movement })),
      isToday,
      isMaturity: date === loan.maturityDate,
      isCapitalization: capitalizationSet.has(date),
    };
    previousClosingValue = closingValue;
    return event;
  });

  const maturityEvent = events.at(-1);
  if (maturityEvent.closingValue !== projection.projectedMaturityValue) {
    throw new Error('Loan timeline maturity does not match the L1 projection');
  }

  const asOfEvent = events.find((event) => event.isToday) || null;
  const historicalEvents = events.filter(
    (event) => compareDateOnly(event.date, asOfDate) < 0,
  );
  const projectedEvents = events.filter(
    (event) => compareDateOnly(event.date, asOfDate) > 0,
  );

  return {
    historicalEvents,
    asOfEvent,
    projectedEvents,
    events,
    projectedMaturityValue: projection.projectedMaturityValue,
    currentValuation,
    projection,
    summary: {
      initialValue: firstContributionAmount(visibleKnownMovements),
      netContributions: currentValuation.netCashFlow,
      interestToDate: currentValuation.totalInterestGenerated,
      currentValue: currentValuation.value,
      projectedFutureInterest: projection.projectedFutureInterest,
      projectedMaturityValue: projection.projectedMaturityValue,
    },
  };
}

export function collapsedLoanTimelineEvents(events, maximum = 10) {
  if (events.length <= maximum) return events;

  const selectedIndexes = new Set([0, events.length - 1]);
  const todayIndex = events.findIndex((event) => event.isToday);
  if (todayIndex >= 0) {
    selectedIndexes.add(todayIndex);
    selectedIndexes.add(Math.max(0, todayIndex - 1));
    selectedIndexes.add(Math.max(0, todayIndex - 2));
    selectedIndexes.add(Math.min(events.length - 1, todayIndex + 1));
    selectedIndexes.add(Math.min(events.length - 1, todayIndex + 2));
  } else {
    events.slice(-4).forEach((_, offset) => selectedIndexes.add(events.length - 4 + offset));
  }

  return [...selectedIndexes]
    .sort((left, right) => left - right)
    .map((index) => events[index]);
}
