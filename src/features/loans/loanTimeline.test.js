import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { buildLoanTimeline, collapsedLoanTimelineEvents } from './loanTimeline';

Decimal.set({ precision: 60, rounding: Decimal.ROUND_HALF_UP });

const baseLoan = Object.freeze({
  name: 'Reclus',
  currency: 'USD',
  startDate: '2026-09-01',
  maturityDate: '2027-09-01',
  rate: '0.0125',
  rateType: 'monthly_effective',
  capitalizationFrequency: 'monthly',
  calculationVersion: 'loan-v1',
});

function loan(overrides = {}) {
  return { ...baseLoan, ...overrides };
}

function contribution(amount, effectiveDate, id = `c-${effectiveDate}`) {
  return { id, type: 'contribution', amount, effectiveDate };
}

function withdrawal(amount, effectiveDate, id = `w-${effectiveDate}`) {
  return { id, type: 'withdrawal', amount, effectiveDate };
}

function build(overrides = {}) {
  return buildLoanTimeline({
    loan: loan(overrides.loan),
    movements: overrides.movements || [contribution('710000', '2026-09-01')],
    asOfDate: overrides.asOfDate || '2026-09-17',
  });
}

function onDate(timeline, date) {
  return timeline.events.find((event) => event.date === date);
}

function expectDecimal(actual, expected, tolerance = '1e-33') {
  const difference = new Decimal(actual).minus(expected).abs();
  expect(
    difference.lessThanOrEqualTo(tolerance),
    `${actual} differs from ${new Decimal(expected).toString()} by ${difference.toString()}`,
  ).toBe(true);
}

describe('buildLoanTimeline', () => {
  it('builds a simple event-only loan flow', () => {
    const timeline = build();

    expect(timeline.events[0]).toMatchObject({
      date: '2026-09-01',
      openingValue: '0',
      interestForInterval: '0',
      movementAmount: '710000',
      closingValue: '710000',
      phase: 'actual',
    });
    expect(timeline.events.at(-1)).toMatchObject({
      date: '2027-09-01',
      isMaturity: true,
      phase: 'projected',
    });
  });

  it('shows a mid-period contribution accruing only from its effective date', () => {
    const timeline = build({
      movements: [
        contribution('710000', '2026-09-01'),
        contribution('450000', '2026-09-13'),
      ],
      asOfDate: '2026-09-20',
    });
    const midMonth = onDate(timeline, '2026-09-13');
    const today = onDate(timeline, '2026-09-20');
    const capitalization = onDate(timeline, '2026-10-01');
    const factorTo13 = new Decimal('1.0125').pow(new Decimal(12).div(30));
    const factorFrom13 = new Decimal('1.0125').pow(new Decimal(18).div(30));
    const expectedAt13 = new Decimal('710000').times(factorTo13).plus('450000');
    const expectedAtCap = new Decimal('710000').times('1.0125')
      .plus(new Decimal('450000').times(factorFrom13));

    expectDecimal(midMonth.closingValue, expectedAt13);
    expect(midMonth.movementAmount).toBe('450000');
    expectDecimal(capitalization.closingValue, expectedAtCap);
    expectDecimal(
      new Decimal(today.interestForInterval).plus(capitalization.interestForInterval),
      expectedAtCap.minus(midMonth.closingValue),
    );
  });

  it('splits interest around a mid-period withdrawal', () => {
    const timeline = build({
      movements: [
        contribution('1000', '2026-09-01'),
        withdrawal('100', '2026-09-16'),
      ],
      asOfDate: '2026-09-20',
    });
    const withdrawalEvent = onDate(timeline, '2026-09-16');
    const capitalization = onDate(timeline, '2026-10-01');

    expect(new Decimal(withdrawalEvent.interestForInterval).greaterThan(0)).toBe(true);
    expect(withdrawalEvent.movementAmount).toBe('-100');
    expect(new Decimal(capitalization.interestForInterval).greaterThan(0)).toBe(true);
    expect(new Decimal(capitalization.interestForInterval).lessThan('6.25')).toBe(true);
  });

  it('keeps multiple movements in the same month as separate dated events', () => {
    const timeline = build({
      movements: [
        contribution('1000', '2026-09-01'),
        contribution('200', '2026-09-10'),
        withdrawal('50', '2026-09-20'),
      ],
      asOfDate: '2026-09-25',
    });

    expect(onDate(timeline, '2026-09-10').movementAmount).toBe('200');
    expect(onDate(timeline, '2026-09-20').movementAmount).toBe('-50');
  });

  it('capitalizes before applying same-day movements', () => {
    const timeline = build({
      movements: [
        contribution('1000', '2026-09-01'),
        contribution('500', '2026-10-01'),
      ],
      asOfDate: '2026-10-10',
    });
    const event = onDate(timeline, '2026-10-01');

    expect(event.kinds).toEqual(expect.arrayContaining(['capitalization', 'contribution']));
    expect(event.openingValue).toBe('1000');
    expect(event.interestForInterval).toBe('12.5');
    expect(event.movementAmount).toBe('500');
    expect(event.closingValue).toBe('1512.5');
  });

  it('shows zero value before a first contribution later than startDate', () => {
    const timeline = build({
      loan: { startDate: '2026-08-15' },
      movements: [contribution('1000', '2026-09-01')],
      asOfDate: '2026-09-10',
    });

    expect(onDate(timeline, '2026-08-15')).toMatchObject({
      closingValue: '0',
      interestForInterval: '0',
      movementAmount: '0',
    });
    expect(onDate(timeline, '2026-09-01').closingValue).toBe('1000');
  });

  it('calculates with the physical correction ledger but presents only the replacement', () => {
    const timeline = build({
      movements: [
        contribution('1000', '2026-09-01', 'initial'),
        contribution('100', '2026-09-10', 'old'),
        { ...withdrawal('100', '2026-09-10', 'reverse-old'), reversesMovementId: 'old' },
        contribution('250', '2026-09-10', 'replacement'),
      ],
      asOfDate: '2026-09-15',
    });
    const event = onDate(timeline, '2026-09-10');

    expect(event.movementAmount).toBe('250');
    expect(event.movements.map((movement) => movement.id)).toEqual(['replacement']);
  });

  it('neutralizes a deleted movement without showing technical activity', () => {
    const timeline = build({
      movements: [
        contribution('1000', '2026-09-01', 'initial'),
        withdrawal('100', '2026-09-10', 'deleted'),
        { ...contribution('100', '2026-09-10', 'void'), reversesMovementId: 'deleted' },
      ],
      asOfDate: '2026-09-15',
    });

    expect(onDate(timeline, '2026-09-10')).toBeUndefined();
    expect(timeline.currentValuation.netCashFlow).toBe('1000');
  });

  it('creates a unique Today event between other dates', () => {
    const timeline = build({ asOfDate: '2026-09-17' });

    expect(timeline.asOfEvent).toMatchObject({ date: '2026-09-17', kind: 'today' });
    expect(timeline.events.filter((event) => event.date === '2026-09-17')).toHaveLength(1);
    expect(new Decimal(timeline.asOfEvent.interestForInterval).greaterThan(0)).toBe(true);
  });

  it('marks an existing financial event as Today without duplicating it', () => {
    const timeline = build({
      movements: [
        contribution('1000', '2026-09-01'),
        contribution('100', '2026-09-13'),
      ],
      asOfDate: '2026-09-13',
    });

    expect(onDate(timeline, '2026-09-13').kinds)
      .toEqual(expect.arrayContaining(['contribution', 'today']));
    expect(timeline.events.filter((event) => event.date === '2026-09-13')).toHaveLength(1);
  });

  it('includes every future capitalization and excludes future movements', () => {
    const timeline = build({
      movements: [
        contribution('1000', '2026-09-01'),
        contribution('9000', '2026-12-15'),
      ],
      asOfDate: '2026-09-17',
    });

    expect(timeline.projectedEvents.filter((event) => event.isCapitalization)).toHaveLength(12);
    expect(onDate(timeline, '2026-12-15')).toBeUndefined();
    expect(timeline.summary.netContributions).toBe('1000');
  });

  it('consolidates maturity with an exact capitalization date', () => {
    const timeline = build();
    const maturity = timeline.events.at(-1);

    expect(maturity.date).toBe('2027-09-01');
    expect(maturity.kinds).toEqual(expect.arrayContaining(['capitalization', 'maturity']));
    expect(timeline.events.filter((event) => event.date === '2027-09-01')).toHaveLength(1);
  });

  it('shows partial-period interest at maturity', () => {
    const timeline = build({ loan: { maturityDate: '2026-10-16' } });
    const maturity = timeline.events.at(-1);

    expect(maturity.date).toBe('2026-10-16');
    expect(maturity.isCapitalization).toBe(false);
    expect(new Decimal(maturity.interestForInterval).greaterThan(0)).toBe(true);
  });

  it('rebuilds future events for a changed maturity', () => {
    const extended = build({ loan: { maturityDate: '2028-03-01' } });

    expect(extended.events.at(-1).date).toBe('2028-03-01');
    expect(extended.projectedEvents.length).toBeGreaterThan(12);
  });

  it('rebuilds all values for a changed rate', () => {
    const original = build();
    const changed = build({ loan: { rate: '0.02' } });

    expect(new Decimal(changed.projectedMaturityValue)
      .greaterThan(original.projectedMaturityValue)).toBe(true);
  });

  it('matches the final row to the exact L1 projection', () => {
    const timeline = build({
      movements: [
        contribution('710000', '2026-09-01'),
        contribution('450000', '2026-09-13'),
        withdrawal('50000', '2026-10-18'),
      ],
      asOfDate: '2026-11-10',
    });

    expect(timeline.events.at(-1).closingValue).toBe(timeline.projectedMaturityValue);
  });

  it('does not mutate its inputs', () => {
    const input = {
      loan: loan(),
      movements: [withdrawal('100', '2026-09-16'), contribution('1000', '2026-09-01')],
      asOfDate: '2026-09-20',
    };
    const snapshot = structuredClone(input);

    buildLoanTimeline(input);

    expect(input).toEqual(snapshot);
  });

  it('preserves the Reclus exact projection regression', () => {
    const timeline = build();

    expect(timeline.projectedMaturityValue)
      .toBe('824135.707583329087399561976781114935875');
  });

  it('keeps the required boundary events when collapsed', () => {
    const timeline = build();
    const collapsed = collapsedLoanTimelineEvents(timeline.events, 6);

    expect(collapsed[0].date).toBe(baseLoan.startDate);
    expect(collapsed.at(-1).date).toBe(baseLoan.maturityDate);
    expect(collapsed.some((event) => event.isToday)).toBe(true);
    expect(collapsed.filter((event) => event.phase === 'projected').length).toBeGreaterThanOrEqual(2);
  });
});
