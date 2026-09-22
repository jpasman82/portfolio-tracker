import Decimal from 'decimal.js';
import {
  addMonthsAnchored,
  compareDateOnly,
  daysBetween,
  parseDateOnly,
  toDateOnly,
  toEpochDay,
} from './loanDates';

/**
 * Presentation-only helpers for the Activos / Préstamos screens.
 *
 * Nothing here computes loan money: every figure is read from values the loan
 * engine (L1) already produced through `buildLoanTimeline`. The only arithmetic
 * allowed is aggregation of those canonical strings (a per-currency total, the
 * interest of a collapsed run of capitalizations) and the geometry that places
 * an already-computed value on a chart.
 */

function sum(values) {
  return values.reduce((total, value) => total.plus(new Decimal(value)), new Decimal(0));
}

function decimalString(value) {
  return value.isZero() ? '0' : value.toString();
}

/**
 * Elapsed share of the loan term at `asOfDate`, for the vigencia bar. `phase`
 * separates a loan that has not started, one running, and one past maturity,
 * so the bar never shows an invented percentage or a negative remainder.
 */
export function loanTermProgress({ loan, asOfDate }) {
  const totalDays = daysBetween(loan.startDate, loan.maturityDate);
  const beforeStart = compareDateOnly(asOfDate, loan.startDate) < 0;
  const afterMaturity = compareDateOnly(asOfDate, loan.maturityDate) >= 0;

  const elapsedDays = beforeStart
    ? 0
    : afterMaturity
      ? totalDays
      : daysBetween(loan.startDate, asOfDate);
  const percent = totalDays === 0 ? 100 : Math.round((elapsedDays / totalDays) * 100);

  return {
    phase: beforeStart ? 'pending' : afterMaturity ? 'matured' : 'active',
    totalDays,
    elapsedDays,
    remainingDays: totalDays - elapsedDays,
    percent: Math.min(100, Math.max(0, percent)),
  };
}

/**
 * Totals per currency for the /activos header. Currencies are never mixed:
 * each keeps its own row, so no exchange rate is ever implied.
 */
export function loanCurrencyTotals(presentations) {
  const order = [];
  const byCurrency = new Map();

  presentations.forEach((presentation) => {
    const { currency } = presentation.loan;
    if (!byCurrency.has(currency)) {
      order.push(currency);
      byCurrency.set(currency, { values: [], interests: [], count: 0 });
    }
    const bucket = byCurrency.get(currency);
    bucket.values.push(presentation.valuation.value);
    bucket.interests.push(presentation.valuation.totalInterestGenerated);
    bucket.count += 1;
  });

  return order.map((currency) => {
    const bucket = byCurrency.get(currency);
    return {
      currency,
      count: bucket.count,
      value: decimalString(sum(bucket.values)),
      interest: decimalString(sum(bucket.interests)),
    };
  });
}

/**
 * Interest as a share of what was actually put in, for the secondary line
 * under the dominant value. Null when there is nothing contributed to compare
 * against, so the UI shows the amount alone instead of a meaningless ratio.
 */
export function interestSharePercent(valuation) {
  const contributed = new Decimal(valuation.netCashFlow);
  if (!contributed.greaterThan(0)) return null;
  return new Decimal(valuation.totalInterestGenerated)
    .div(contributed)
    .times(100)
    .toDecimalPlaces(1, Decimal.ROUND_HALF_UP)
    .toNumber();
}

/** -1, 0 or 1 for a canonical amount — sign inspection without Decimal in a
 *  component. */
export function amountSign(value) {
  const amount = new Decimal(value);
  return amount.isZero() ? 0 : amount.isNegative() ? -1 : 1;
}

/** The magnitude of a canonical amount, for rendering the sign separately. */
export function absoluteAmount(value) {
  return new Decimal(value).abs().toString();
}

const SHORT_MONTHS = Object.freeze([
  'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC',
]);

/** "SEP 26" — compact axis and timeline labels. */
export function formatMonthYear(date) {
  const { year, month } = parseDateOnly(date);
  return `${SHORT_MONTHS[month - 1]} ${String(year).slice(-2)}`;
}

/** Day and month on two lines, for the mobile timeline gutter. */
export function formatDayMonth(date) {
  const { month, day } = parseDateOnly(date);
  return { day: String(day).padStart(2, '0'), month: SHORT_MONTHS[month - 1] };
}

export function formatPercentValue(value) {
  if (value === null || value === undefined) return '—';
  return `${String(value).replace('.', ',')} %`;
}

/**
 * Interest the next capitalization will add, read from the timeline event that
 * already stands on `valuation.nextCapitalizationDate`. Null when the loan has
 * no further capitalization (matured, or maturity reached first).
 */
export function nextCapitalizationPreview({ timeline, valuation, asOfDate }) {
  const date = valuation.nextCapitalizationDate;
  if (!date) return null;
  const event = timeline.events.find(
    (candidate) => candidate.date === date && candidate.isCapitalization,
  );
  if (!event) return null;
  return {
    date,
    amount: event.interestForInterval,
    daysAway: compareDateOnly(date, asOfDate) > 0 ? daysBetween(asOfDate, date) : 0,
  };
}

function isPlainCapitalization(event) {
  return event.isCapitalization
    && !event.isToday
    && !event.isMaturity
    && event.movements.length === 0
    && new Decimal(event.movementAmount).isZero();
}

/**
 * Collapses consecutive capitalization-only events into one summary row.
 * Purely a view transform: a grouped row carries the sum of interest the engine
 * already produced, and the caller can always render `events` untouched.
 */
export function groupLoanFlowEvents(events, { minimumRun = 2 } = {}) {
  const rows = [];
  let index = 0;

  while (index < events.length) {
    const event = events[index];
    if (!isPlainCapitalization(event)) {
      rows.push({ kind: 'event', key: event.date, event });
      index += 1;
      continue;
    }

    // A run never crosses the actual/projected boundary, so a collapsed row
    // always belongs to exactly one phase.
    let end = index;
    while (
      end + 1 < events.length
      && isPlainCapitalization(events[end + 1])
      && events[end + 1].phase === event.phase
    ) end += 1;
    const run = events.slice(index, end + 1);

    if (run.length < minimumRun) {
      run.forEach((item) => rows.push({ kind: 'event', key: item.date, event: item }));
    } else {
      rows.push({
        kind: 'group',
        key: `group-${run[0].date}-${run.at(-1).date}`,
        count: run.length,
        fromDate: run[0].date,
        toDate: run.at(-1).date,
        phase: run.at(-1).phase,
        openingValue: run[0].openingValue,
        interestForInterval: decimalString(sum(run.map((item) => item.interestForInterval))),
        closingValue: run.at(-1).closingValue,
        events: run,
      });
    }
    index = end + 1;
  }

  return rows;
}

/**
 * Chart geometry for the balance curve. Every plotted value is an engine figure
 * already present on a timeline event: `closingValue`, plus — on an event that
 * carries a movement — the pre-movement value `closingValue - movementAmount`
 * (identical to `openingValue + interestForInterval`), which is what draws the
 * vertical step. Only the mapping onto the viewBox happens here.
 */
export function buildLoanFlowChart({
  events,
  asOfDate,
  width = 720,
  height = 200,
  padding = 12,
  paddingX = 8,
}) {
  if (!Array.isArray(events) || events.length < 2) return null;

  const samples = [];
  events.forEach((event, index) => {
    const closing = new Decimal(event.closingValue);
    const movement = new Decimal(event.movementAmount);
    // The opening step is skipped on the first event: its pre-movement value is
    // zero and would flatten the whole curve against the floor of the box.
    if (index > 0 && !movement.isZero()) {
      samples.push({ date: event.date, value: closing.minus(movement), event, step: true });
    }
    samples.push({ date: event.date, value: closing, event, step: false });
  });

  const firstDay = toEpochDay(samples[0].date);
  const daySpan = toEpochDay(samples.at(-1).date) - firstDay;
  if (daySpan <= 0) return null;

  const values = samples.map((sample) => sample.value);
  const maximum = values.reduce((top, value) => (value.greaterThan(top) ? value : top), values[0]);
  const minimum = values.reduce((low, value) => (value.lessThan(low) ? value : low), values[0]);
  const range = maximum.minus(minimum);
  const usableHeight = height - padding * 2;

  // The horizontal inset keeps the first and last markers fully inside the box
  // instead of being halved by the viewBox edge.
  const usableWidth = width - paddingX * 2;
  const toX = (date) => Number((
    paddingX + ((toEpochDay(date) - firstDay) / daySpan) * usableWidth
  ).toFixed(2));
  // y grows downward: the maximum sits at `padding`, the minimum on the floor.
  const toY = (value) => Number((range.isZero()
    ? padding + usableHeight / 2
    : padding + Number(maximum.minus(value).div(range).toFixed(6)) * usableHeight
  ).toFixed(2));

  const points = samples.map((sample) => ({
    x: toX(sample.date),
    y: toY(sample.value),
    date: sample.date,
    step: sample.step,
    phase: sample.event.phase,
    isToday: sample.event.isToday,
    isMaturity: sample.event.isMaturity,
    hasMovement: !new Decimal(sample.event.movementAmount).isZero(),
  }));

  const splitIndex = points.reduce(
    (last, point, index) => (compareDateOnly(point.date, asOfDate) <= 0 ? index : last),
    0,
  );
  const actual = points.slice(0, splitIndex + 1);
  const projected = points.slice(splitIndex);
  const todayPoint = points.find((point) => point.isToday) || null;
  const asLine = (list) => list.map((point) => `${point.x},${point.y}`).join(' ');

  return {
    width,
    height,
    actualLine: actual.length > 1 ? asLine(actual) : '',
    projectedLine: projected.length > 1 ? asLine(projected) : '',
    todayPoint,
    todayX: todayPoint ? todayPoint.x : null,
    movementPoints: points.filter((point) => point.hasMovement && !point.step),
    startPoint: points[0],
    maturityPoint: points.at(-1),
    maximumValue: decimalString(maximum),
    minimumValue: decimalString(minimum),
    firstDate: samples[0].date,
    lastDate: samples.at(-1).date,
  };
}

/**
 * Same day-of-month `months` ahead, clamped to the target month's length. A
 * pure date helper over `addMonthsAnchored`, used only to prefill the
 * ampliación shortcuts; the value still goes through the normal validation.
 */
export function shiftDateByMonths(date, months) {
  return addMonthsAnchored(date, months, parseDateOnly(date).day);
}

/**
 * Date shortcuts offered by the movement sheet: today, yesterday, and the most
 * recent date already used on this loan. Dates outside the loan term are
 * dropped rather than clamped, so a shortcut can never propose an invalid day.
 */
export function movementDateShortcuts({ loan, today, movements = [] }) {
  const withinTerm = (date) => compareDateOnly(date, loan.startDate) >= 0
    && compareDateOnly(date, loan.maturityDate) <= 0;

  const lastUsed = movements.reduce(
    (latest, movement) => (
      !latest || compareDateOnly(movement.effectiveDate, latest) > 0
        ? movement.effectiveDate
        : latest
    ),
    null,
  );

  const { year, month, day } = parseDateOnly(today);
  const previousDay = new Date(Date.UTC(year, month - 1, day - 1));
  const yesterday = toDateOnly({
    year: previousDay.getUTCFullYear(),
    month: previousDay.getUTCMonth() + 1,
    day: previousDay.getUTCDate(),
  });

  const candidates = [
    { id: 'today', label: 'Hoy', date: today },
    { id: 'yesterday', label: 'Ayer', date: yesterday },
    ...(lastUsed ? [{ id: 'last', label: 'Último movimiento', date: lastUsed }] : []),
  ];

  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!withinTerm(candidate.date) || seen.has(candidate.date)) return false;
    seen.add(candidate.date);
    return true;
  });
}
