import { describe, expect, it } from 'vitest';
import {
  LOAN_FLOW_DEFAULT_EXPANDED,
  buildLoanFlowChart,
  groupLoanFlowEvents,
  loanDetailActions,
  loanFlowRows,
  interestSharePercent,
  loanCurrencyTotals,
  loanTermProgress,
  movementDateShortcuts,
  nextCapitalizationPreview,
  shiftDateByMonths,
} from './loanPresentation';
import { buildLoanTimeline } from './loanTimeline';
import { effectiveLoanStatus } from './loanUi';

const LOAN = Object.freeze({
  name: 'Contraparte',
  currency: 'USD',
  startDate: '2026-03-05',
  maturityDate: '2027-03-05',
  rate: '0.0125',
  rateType: 'monthly_effective',
  capitalizationFrequency: 'monthly',
  calculationVersion: 'loan-v1',
});

const MOVEMENTS = Object.freeze([
  { id: 'm1', type: 'contribution', effectiveDate: '2026-03-05', amount: '710000' },
  { id: 'm2', type: 'contribution', effectiveDate: '2026-09-16', amount: '10000' },
]);

const timelineAt = (asOfDate) => buildLoanTimeline({ loan: LOAN, movements: [...MOVEMENTS], asOfDate });

describe('loan term progress', () => {
  it('reports the elapsed share of a running term', () => {
    const term = loanTermProgress({ loan: LOAN, asOfDate: '2026-09-21' });
    expect(term.phase).toBe('active');
    expect(term.totalDays).toBe(365);
    expect(term.elapsedDays).toBe(200);
    expect(term.remainingDays).toBe(165);
    expect(term.percent).toBe(55);
  });

  it('clamps a loan that has not started and one already matured', () => {
    expect(loanTermProgress({ loan: LOAN, asOfDate: '2026-01-01' })).toMatchObject({
      phase: 'pending', elapsedDays: 0, percent: 0,
    });
    expect(loanTermProgress({ loan: LOAN, asOfDate: '2027-06-01' })).toMatchObject({
      phase: 'matured', elapsedDays: 365, remainingDays: 0, percent: 100,
    });
  });
});

describe('per-currency totals', () => {
  it('keeps every currency apart instead of implying an exchange rate', () => {
    const totals = loanCurrencyTotals([
      { loan: { currency: 'USD' }, valuation: { value: '100.5', totalInterestGenerated: '10.5' } },
      { loan: { currency: 'ARS' }, valuation: { value: '2000', totalInterestGenerated: '500' } },
      { loan: { currency: 'USD' }, valuation: { value: '9.5', totalInterestGenerated: '1.5' } },
    ]);

    expect(totals).toEqual([
      { currency: 'USD', count: 2, value: '110', interest: '12' },
      { currency: 'ARS', count: 1, value: '2000', interest: '500' },
    ]);
  });

  it('reports the interest share only when something was contributed', () => {
    expect(interestSharePercent({ netCashFlow: '660000', totalInterestGenerated: '57691.96' }))
      .toBe(8.7);
    expect(interestSharePercent({ netCashFlow: '0', totalInterestGenerated: '0' })).toBeNull();
  });
});

describe('next capitalization preview', () => {
  it('reads the amount from the timeline event rather than recomputing it', () => {
    const timeline = timelineAt('2026-09-21');
    const preview = nextCapitalizationPreview({
      timeline,
      valuation: timeline.currentValuation,
      asOfDate: '2026-09-21',
    });

    const event = timeline.events.find((item) => item.date === preview.date);
    expect(preview.date).toBe(timeline.currentValuation.nextCapitalizationDate);
    expect(preview.amount).toBe(event.interestForInterval);
    expect(preview.daysAway).toBe(14);
  });

  it('returns nothing once the loan has matured', () => {
    const timeline = timelineAt('2027-05-01');
    expect(nextCapitalizationPreview({
      timeline,
      valuation: timeline.currentValuation,
      asOfDate: '2027-05-01',
    })).toBeNull();
  });
});

describe('flow grouping is presentation only', () => {
  it('collapses runs of capitalizations without altering any engine figure', () => {
    const timeline = timelineAt('2026-09-21');
    const rows = groupLoanFlowEvents(timeline.events);

    expect(rows.length).toBeLessThan(timeline.events.length);
    const expanded = rows.flatMap((row) => (row.kind === 'group' ? row.events : [row.event]));
    expect(expanded).toEqual(timeline.events);

    const group = rows.find((row) => row.kind === 'group');
    expect(group.count).toBe(group.events.length);
    expect(group.openingValue).toBe(group.events[0].openingValue);
    expect(group.closingValue).toBe(group.events.at(-1).closingValue);
  });

  it('never merges realised and projected events into one row', () => {
    const rows = groupLoanFlowEvents(timelineAt('2026-09-21').events);
    rows.filter((row) => row.kind === 'group').forEach((row) => {
      expect(new Set(row.events.map((event) => event.phase)).size).toBe(1);
    });
  });

  it('leaves a lone capitalization as its own row', () => {
    const rows = groupLoanFlowEvents(timelineAt('2026-04-10').events);
    const firstCapitalization = rows.find(
      (row) => row.kind === 'event' && row.event.isCapitalization,
    );
    expect(firstCapitalization).toBeDefined();
  });
});

describe('flow chart geometry', () => {
  it('plots only values the timeline already produced', () => {
    const timeline = timelineAt('2026-09-21');
    const chart = buildLoanFlowChart({ events: timeline.events, asOfDate: '2026-09-21' });

    expect(chart.firstDate).toBe(timeline.events[0].date);
    expect(chart.lastDate).toBe(timeline.events.at(-1).date);
    expect(chart.maximumValue).toBe(timeline.projectedMaturityValue);
    expect(chart.todayPoint).not.toBeNull();
    expect(chart.actualLine).not.toBe('');
    expect(chart.projectedLine).not.toBe('');

    const coordinates = `${chart.actualLine} ${chart.projectedLine}`
      .split(' ')
      .filter(Boolean)
      .map((pair) => pair.split(',').map(Number));
    coordinates.forEach(([x, y]) => {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(chart.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(chart.height);
    });
  });

  it('draws a vertical step where a movement lands', () => {
    const timeline = timelineAt('2026-09-21');
    const chart = buildLoanFlowChart({ events: timeline.events, asOfDate: '2026-09-21' });
    const movementPoint = chart.movementPoints.find((point) => point.date === '2026-09-16');

    expect(movementPoint).toBeDefined();
    expect(chart.actualLine).toContain(`${movementPoint.x},`);
    // Both the pre- and post-movement values sit on the same x.
    const sameX = chart.actualLine
      .split(' ')
      .filter((pair) => pair.startsWith(`${movementPoint.x},`));
    expect(sameX.length).toBe(2);
  });

  it('gives a matured loan no projected segment', () => {
    const timeline = timelineAt('2027-06-01');
    const chart = buildLoanFlowChart({ events: timeline.events, asOfDate: '2027-06-01' });
    expect(chart.projectedLine).toBe('');
    expect(chart.maturityPoint.phase).toBe('actual');
  });
});

describe('date shortcuts are pure UI helpers', () => {
  it('anchors a maturity extension to the same day of the month', () => {
    expect(shiftDateByMonths('2027-03-05', 6)).toBe('2027-09-05');
    expect(shiftDateByMonths('2027-03-31', 1)).toBe('2027-04-30');
    expect(shiftDateByMonths('2026-03-05', 12)).toBe('2027-03-05');
  });

  it('offers only dates inside the loan term', () => {
    const shortcuts = movementDateShortcuts({
      loan: LOAN,
      today: '2026-09-21',
      movements: [...MOVEMENTS],
    });
    expect(shortcuts.map((item) => item.date)).toEqual(['2026-09-21', '2026-09-20', '2026-09-16']);
  });

  it('drops shortcuts that fall outside the term', () => {
    const shortcuts = movementDateShortcuts({
      loan: LOAN,
      today: '2026-03-05',
      movements: [{ effectiveDate: '2026-03-05' }],
    });
    expect(shortcuts.map((item) => item.id)).toEqual(['today']);
  });
});

describe('flow view state', () => {
  const events = timelineAt('2026-09-21').events;

  it('opens showing every event, not the grouped summary', () => {
    expect(LOAN_FLOW_DEFAULT_EXPANDED).toBe(true);

    const view = loanFlowRows({ events, expanded: LOAN_FLOW_DEFAULT_EXPANDED });
    expect(view.rows).toHaveLength(events.length);
    expect(view.rows.every((row) => row.kind === 'event')).toBe(true);
    expect(view.rows.map((row) => row.event)).toEqual(events);
  });

  it('summarises on request and restores every original event', () => {
    const summarised = loanFlowRows({ events, expanded: false });
    expect(summarised.canSummarise).toBe(true);
    expect(summarised.rows.length).toBeLessThan(events.length);
    expect(summarised.rows.some((row) => row.kind === 'group')).toBe(true);

    const restored = loanFlowRows({ events, expanded: true });
    expect(restored.rows.map((row) => row.event)).toEqual(events);
  });

  it('never changes the underlying events when the view switches', () => {
    const summarised = loanFlowRows({ events, expanded: false });
    const flattened = summarised.rows.flatMap(
      (row) => (row.kind === 'group' ? row.events : [row.event]),
    );
    expect(flattened).toEqual(events);
  });

  it('hides the toggle when grouping would not shorten anything', () => {
    const shortRun = events.filter((event) => !event.isCapitalization);
    const view = loanFlowRows({ events: shortRun, expanded: false });
    expect(view.canSummarise).toBe(false);
    expect(view.rows).toHaveLength(shortRun.length);
  });
});

describe('loan detail actions', () => {
  const activeLoan = { status: 'active' };

  it('leads with a new movement while the loan is running', () => {
    expect(loanDetailActions({ loan: activeLoan, effectiveStatus: 'active' })).toEqual({
      canManage: true,
      pastMaturity: false,
      canEditTerms: true,
      canAddMovement: true,
      primaryAction: 'movement',
    });
  });

  it('stops offering a new movement once the loan is effectively matured', () => {
    const actions = loanDetailActions({ loan: activeLoan, effectiveStatus: 'matured' });
    expect(actions.canAddMovement).toBe(false);
    expect(actions.primaryAction).not.toBe('movement');
  });

  it('keeps editing the terms and leads with the extension when matured', () => {
    const actions = loanDetailActions({ loan: activeLoan, effectiveStatus: 'matured' });
    expect(actions.canManage).toBe(true);
    expect(actions.canEditTerms).toBe(true);
    expect(actions.primaryAction).toBe('maturity_extension');
  });

  it('offers nothing once the stored status stops accepting changes', () => {
    ['closed', 'cancelled'].forEach((status) => {
      const actions = loanDetailActions({ loan: { status }, effectiveStatus: status });
      expect(actions).toMatchObject({
        canManage: false,
        canEditTerms: false,
        canAddMovement: false,
        primaryAction: null,
      });
    });
  });

  it('matches the effective status the UI already derives from the dates', () => {
    const running = effectiveLoanStatus({ ...LOAN, status: 'active' }, '2026-09-21');
    const expired = effectiveLoanStatus({ ...LOAN, status: 'active' }, '2027-03-05');

    expect(loanDetailActions({ loan: activeLoan, effectiveStatus: running }).primaryAction)
      .toBe('movement');
    expect(loanDetailActions({ loan: activeLoan, effectiveStatus: expired }).primaryAction)
      .toBe('maturity_extension');
  });
});
