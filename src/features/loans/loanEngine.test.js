import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { calculateLoanAtDate, projectLoanToMaturity } from './loanEngine';
import { LoanValidationError } from './loanModel';

Decimal.set({ precision: 60, rounding: Decimal.ROUND_HALF_UP });

const MONTHLY_RATE = '0.0125';

const reclusLoan = Object.freeze({
  name: 'Reclus',
  currency: 'USD',
  startDate: '2026-09-01',
  maturityDate: '2027-09-01',
  rate: MONTHLY_RATE,
  rateType: 'monthly_effective',
  capitalizationFrequency: 'monthly',
  calculationVersion: 'loan-v1',
});

const reclusMovements = Object.freeze([
  Object.freeze({ effectiveDate: '2026-09-01', type: 'contribution', amount: '710000' }),
]);

function loan(overrides = {}) {
  return {
    currency: 'USD',
    startDate: '2026-09-01',
    maturityDate: '2027-09-01',
    rate: MONTHLY_RATE,
    rateType: 'monthly_effective',
    capitalizationFrequency: 'monthly',
    calculationVersion: 'loan-v1',
    ...overrides,
  };
}

function contribution(amount = '1000', effectiveDate = '2026-09-01') {
  return { effectiveDate, type: 'contribution', amount };
}

function withdrawal(amount, effectiveDate) {
  return { effectiveDate, type: 'withdrawal', amount };
}

function expectDecimal(actual, expected, tolerance = '1e-33') {
  const difference = new Decimal(actual).minus(expected).abs();
  expect(
    difference.lessThanOrEqualTo(tolerance),
    `${actual} differs from ${new Decimal(expected).toString()} by ${difference.toString()}`
  ).toBe(true);
}

function expectedCompound(principal, periods, rate = MONTHLY_RATE) {
  return new Decimal(principal).times(new Decimal(1).plus(rate).pow(periods));
}

function expectAccountingIdentities(result) {
  expectDecimal(
    result.value,
    new Decimal(result.netCashFlow).plus(result.totalInterestGenerated)
  );
  expectDecimal(
    result.value,
    new Decimal(result.capitalizedBalance).plus(result.accruedInterest)
  );
}

describe('Reclus acceptance fixture', () => {
  it('starts at the initial contribution value', () => {
    const result = calculateLoanAtDate({
      loan: reclusLoan,
      movements: reclusMovements,
      asOfDate: '2026-09-01',
    });

    expect(result.value).toBe('710000');
    expect(result.accruedInterest).toBe('0');
    expect(result.nextCapitalizationDate).toBe('2026-10-01');
    expectAccountingIdentities(result);
  });

  it('uses exponential prorating inside the first period', () => {
    const result = calculateLoanAtDate({
      loan: reclusLoan,
      movements: reclusMovements,
      asOfDate: '2026-09-16',
    });
    const expected = new Decimal('710000').times(
      new Decimal('1.0125').pow(new Decimal(15).div(30))
    );

    expectDecimal(result.value, expected);
    expect(result.capitalizedBalance).toBe('710000');
    expectDecimal(result.accruedInterest, expected.minus('710000'));
    expectAccountingIdentities(result);
  });

  it('capitalizes the first complete month exactly', () => {
    const result = calculateLoanAtDate({
      loan: reclusLoan,
      movements: reclusMovements,
      asOfDate: '2026-10-01',
    });

    expect(result.value).toBe('718875');
    expect(result.capitalizedBalance).toBe('718875');
    expect(result.accruedInterest).toBe('0');
    expect(result.lastCapitalizationDate).toBe('2026-10-01');
  });

  it('supports multiple monthly capitalizations', () => {
    const result = calculateLoanAtDate({
      loan: reclusLoan,
      movements: reclusMovements,
      asOfDate: '2027-03-01',
    });

    expectDecimal(result.value, expectedCompound('710000', 6));
    expect(result.lastCapitalizationDate).toBe('2027-03-01');
  });

  it('matches the mandatory twelve-capitalization maturity value', () => {
    const result = calculateLoanAtDate({
      loan: reclusLoan,
      movements: reclusMovements,
      asOfDate: '2027-09-01',
    });

    expect(result.value).toBe('824135.707583329087399561976781114935875');
    expect(new Decimal(result.value).toDecimalPlaces(2).toFixed(2)).toBe('824135.71');
    expect(result.capitalizedBalance).toBe(result.value);
    expect(result.accruedInterest).toBe('0');
    expect(result.lastCapitalizationDate).toBe('2027-09-01');
    expect(result.nextCapitalizationDate).toBeNull();
    expect(result.matured).toBe(true);
    expectAccountingIdentities(result);
  });

  it('projects Reclus to the same maturity value', () => {
    const projection = projectLoanToMaturity({
      loan: reclusLoan,
      movements: reclusMovements,
      asOfDate: '2026-09-16',
    });

    expect(projection.projectedMaturityValue)
      .toBe('824135.707583329087399561976781114935875');
    expect(projection.maturityDate).toBe('2027-09-01');
  });
});

describe('movements', () => {
  it('applies a contribution on its effective date and accrues from that date', () => {
    const movements = [
      contribution('1000'),
      contribution('500', '2026-09-16'),
    ];
    const atMovement = calculateLoanAtDate({ loan: loan(), movements, asOfDate: '2026-09-16' });
    const atCapitalization = calculateLoanAtDate({ loan: loan(), movements, asOfDate: '2026-10-01' });
    const halfPeriodFactor = new Decimal('1.0125').pow(new Decimal(15).div(30));
    const expected = new Decimal('1000').times('1.0125')
      .plus(new Decimal('500').times(halfPeriodFactor));

    expectDecimal(atMovement.value, new Decimal('1000').times(halfPeriodFactor).plus('500'));
    expectDecimal(atCapitalization.value, expected);
  });

  it('applies a withdrawal on its effective date without allowing a negative value', () => {
    const movements = [contribution('1000'), withdrawal('100', '2026-09-16')];
    const before = calculateLoanAtDate({ loan: loan(), movements, asOfDate: '2026-09-15' });
    const onDate = calculateLoanAtDate({ loan: loan(), movements, asOfDate: '2026-09-16' });

    expectDecimal(onDate.value, new Decimal(before.value)
      .times(new Decimal('1.0125').pow(new Decimal(1).div(30)))
      .minus('100'));
    expect(onDate.netCashFlow).toBe('900');
    expectAccountingIdentities(onDate);
  });

  it('reduces the return-generating balance from the withdrawal date', () => {
    const result = calculateLoanAtDate({
      loan: loan(),
      movements: [contribution('1000'), withdrawal('100', '2026-09-16')],
      asOfDate: '2026-10-01',
    });
    const remainingPeriodFactor = new Decimal('1.0125').pow(new Decimal(15).div(30));
    const expected = new Decimal('1000').times('1.0125')
      .minus(new Decimal('100').times(remainingPeriodFactor));

    expectDecimal(result.value, expected);
    expectAccountingIdentities(result);
  });

  it('allows withdrawing exactly the available value without later negative accrual', () => {
    const available = calculateLoanAtDate({
      loan: loan(),
      movements: [contribution('1000')],
      asOfDate: '2026-09-16',
    }).value;
    const movements = [contribution('1000'), withdrawal(available, '2026-09-16')];
    const onWithdrawal = calculateLoanAtDate({ loan: loan(), movements, asOfDate: '2026-09-16' });
    const atCapitalization = calculateLoanAtDate({ loan: loan(), movements, asOfDate: '2026-10-01' });

    expect(onWithdrawal.value).toBe('0');
    expectDecimal(atCapitalization.value, '0');
    expect(new Decimal(atCapitalization.value).isNegative()).toBe(false);
    expectAccountingIdentities(onWithdrawal);
    expectAccountingIdentities(atCapitalization);
  });

  it('does not allocate a withdrawal between interest and principal', () => {
    const beforeWithdrawal = calculateLoanAtDate({
      loan: loan(),
      movements: [contribution('1000')],
      asOfDate: '2026-09-16',
    });
    const withdrawalAmount = new Decimal(beforeWithdrawal.accruedInterest).div(2);
    const result = calculateLoanAtDate({
      loan: loan(),
      movements: [contribution('1000'), withdrawal(withdrawalAmount.toString(), '2026-09-16')],
      asOfDate: '2026-09-16',
    });

    expectDecimal(result.capitalizedBalance, new Decimal('1000').minus(withdrawalAmount));
    expect(result.accruedInterest).toBe(beforeWithdrawal.accruedInterest);
    expect(result.totalInterestGenerated).toBe(beforeWithdrawal.totalInterestGenerated);
    expectDecimal(result.value, new Decimal(beforeWithdrawal.value).minus(withdrawalAmount));
    expectAccountingIdentities(result);
  });

  it('handles contributions and withdrawals on distinct dates', () => {
    const movements = [
      contribution('1000'),
      contribution('250', '2026-09-10'),
      withdrawal('125', '2026-09-20'),
    ];
    const result = calculateLoanAtDate({ loan: loan(), movements, asOfDate: '2026-10-01' });

    expect(result.netCashFlow).toBe('1125');
    expect(new Decimal(result.value).greaterThan('1125')).toBe(true);
    expectAccountingIdentities(result);
  });

  it('sorts unordered movements deterministically', () => {
    const ordered = [
      contribution('1000'),
      contribution('250', '2026-09-10'),
      withdrawal('125', '2026-09-20'),
    ];
    const unordered = [ordered[2], ordered[0], ordered[1]];

    expect(calculateLoanAtDate({ loan: loan(), movements: unordered, asOfDate: '2026-11-01' }))
      .toEqual(calculateLoanAtDate({ loan: loan(), movements: ordered, asOfDate: '2026-11-01' }));
  });

  it('batches a same-day contribution and withdrawal independently of input order', () => {
    const firstOrder = calculateLoanAtDate({
      loan: loan(),
      movements: [
        withdrawal('300', '2026-09-10'),
        contribution('1000'),
        contribution('200', '2026-09-10'),
      ],
      asOfDate: '2026-09-10',
    });
    const secondOrder = calculateLoanAtDate({
      loan: loan(),
      movements: [
        contribution('200', '2026-09-10'),
        contribution('1000'),
        withdrawal('300', '2026-09-10'),
      ],
      asOfDate: '2026-09-10',
    });

    expect(secondOrder).toEqual(firstOrder);
    expect(firstOrder.netCashFlow).toBe('900');
    expectDecimal(firstOrder.value, new Decimal('1000')
      .times(new Decimal('1.0125').pow(new Decimal(9).div(30)))
      .minus('100'));
  });

  it('batches several same-day contributions and withdrawals in any order', () => {
    const movements = [
      contribution('1000'),
      contribution('200', '2026-09-10'),
      withdrawal('75', '2026-09-10'),
      contribution('50', '2026-09-10'),
      withdrawal('125', '2026-09-10'),
    ];
    const permutation = [movements[4], movements[2], movements[0], movements[3], movements[1]];
    const first = calculateLoanAtDate({ loan: loan(), movements, asOfDate: '2026-11-01' });
    const second = calculateLoanAtDate({
      loan: loan(),
      movements: permutation,
      asOfDate: '2026-11-01',
    });

    expect(second).toEqual(first);
    expect(first.netCashFlow).toBe('1050');
    expectAccountingIdentities(first);
  });

  it('allows same-day contributions to cover the total withdrawal batch', () => {
    const sameDayMovements = [
      contribution('1000'),
      withdrawal('1200', '2026-09-10'),
      contribution('250', '2026-09-10'),
    ];
    const reversedBatch = [sameDayMovements[2], sameDayMovements[1], sameDayMovements[0]];
    const first = calculateLoanAtDate({
      loan: loan(),
      movements: sameDayMovements,
      asOfDate: '2026-09-10',
    });
    const second = calculateLoanAtDate({
      loan: loan(),
      movements: reversedBatch,
      asOfDate: '2026-09-10',
    });

    expect(second).toEqual(first);
    expect(first.netCashFlow).toBe('50');
    expect(new Decimal(first.value).greaterThanOrEqualTo(0)).toBe(true);
  });

  it('capitalizes before applying a movement on the capitalization date', () => {
    const result = calculateLoanAtDate({
      loan: loan(),
      movements: [contribution('1000'), contribution('500', '2026-10-01')],
      asOfDate: '2026-10-01',
    });

    expect(result.value).toBe('1512.5');
    expect(result.capitalizedBalance).toBe('1512.5');
    expect(result.accruedInterest).toBe('0');
  });

  it('batches capitalization-date movements independently of input order', () => {
    const movements = [
      contribution('1000'),
      withdrawal('600', '2026-10-01'),
      contribution('500', '2026-10-01'),
      withdrawal('25', '2026-10-01'),
    ];
    const permutation = [movements[3], movements[2], movements[1], movements[0]];
    const first = calculateLoanAtDate({ loan: loan(), movements, asOfDate: '2026-10-01' });
    const second = calculateLoanAtDate({
      loan: loan(),
      movements: permutation,
      asOfDate: '2026-10-01',
    });

    expect(second).toEqual(first);
    expect(first.value).toBe('887.5');
    expect(first.capitalizedBalance).toBe('887.5');
    expect(first.accruedInterest).toBe('0');
  });

  it('ignores future movements in a historical valuation', () => {
    const baseline = calculateLoanAtDate({
      loan: loan(),
      movements: [contribution('1000')],
      asOfDate: '2026-09-15',
    });
    const withFutureMovement = calculateLoanAtDate({
      loan: loan(),
      movements: [contribution('1000'), contribution('9000', '2026-10-15')],
      asOfDate: '2026-09-15',
    });

    expect(withFutureMovement).toEqual(baseline);
  });

  it('rejects a withdrawal above the available value', () => {
    expect(() => calculateLoanAtDate({
      loan: loan(),
      movements: [contribution('1000'), withdrawal('1001', '2026-09-01')],
      asOfDate: '2026-09-01',
    })).toThrowError(expect.objectContaining({
      name: 'LoanValidationError',
      code: 'WITHDRAWAL_EXCEEDS_AVAILABLE_VALUE',
    }));
  });

  it('treats two equal same-day contributions like their sum', () => {
    const split = calculateLoanAtDate({
      loan: loan(),
      movements: [contribution('500'), contribution('500')],
      asOfDate: '2026-10-01',
    });
    const combined = calculateLoanAtDate({
      loan: loan(),
      movements: [contribution('1000')],
      asOfDate: '2026-10-01',
    });

    expect(split).toEqual(combined);
  });
});

describe('date boundaries and maturity', () => {
  it('returns zero before the loan start', () => {
    const result = calculateLoanAtDate({
      loan: loan(),
      movements: [contribution('1000')],
      asOfDate: '2026-08-31',
    });

    expect(result.value).toBe('0');
    expect(result.netCashFlow).toBe('0');
  });

  it('distinguishes the day before, exact date, and day after capitalization', () => {
    const movements = [contribution('1000')];
    const dayBefore = calculateLoanAtDate({ loan: loan(), movements, asOfDate: '2026-09-30' });
    const exact = calculateLoanAtDate({ loan: loan(), movements, asOfDate: '2026-10-01' });
    const dayAfter = calculateLoanAtDate({ loan: loan(), movements, asOfDate: '2026-10-02' });

    expect(dayBefore.lastCapitalizationDate).toBeNull();
    expect(exact.lastCapitalizationDate).toBe('2026-10-01');
    expect(exact.accruedInterest).toBe('0');
    expect(dayAfter.lastCapitalizationDate).toBe('2026-10-01');
    expect(new Decimal(dayBefore.value).lessThan(exact.value)).toBe(true);
    expect(new Decimal(dayAfter.value).greaterThan(exact.value)).toBe(true);
  });

  it.each([
    ['2026-01-28', '2026-02-28'],
    ['2024-01-29', '2024-02-29'],
    ['2026-01-30', '2026-02-28'],
    ['2026-01-31', '2026-02-28'],
  ])('capitalizes a loan starting on %s at %s', (startDate, firstCapitalization) => {
    const customLoan = loan({ startDate, maturityDate: '2027-06-30' });
    const result = calculateLoanAtDate({
      loan: customLoan,
      movements: [contribution('1000', startDate)],
      asOfDate: firstCapitalization,
    });

    expect(result.value).toBe('1012.5');
    expect(result.lastCapitalizationDate).toBe(firstCapitalization);
  });

  it('includes an incomplete maturity period and stops accruing afterwards', () => {
    const customLoan = loan({ maturityDate: '2026-10-16' });
    const movements = [contribution('1000')];
    const atMaturity = calculateLoanAtDate({ loan: customLoan, movements, asOfDate: '2026-10-16' });
    const afterMaturity = calculateLoanAtDate({ loan: customLoan, movements, asOfDate: '2027-01-01' });
    const expected = new Decimal('1012.5').times(
      new Decimal('1.0125').pow(new Decimal(15).div(31))
    );

    expectDecimal(atMaturity.value, expected);
    expect(afterMaturity.value).toBe(atMaturity.value);
    expect(afterMaturity.valuationDate).toBe('2026-10-16');
    expect(afterMaturity.matured).toBe(true);
    expect(afterMaturity.nextCapitalizationDate).toBeNull();
  });
});

describe('mathematics, precision, and determinism', () => {
  it('keeps a zero-rate loan equal to its net cash flow', () => {
    const result = calculateLoanAtDate({
      loan: loan({ rate: '0' }),
      movements: [contribution('1000'), contribution('25', '2026-09-15'), withdrawal('10', '2026-10-15')],
      asOfDate: '2027-01-01',
    });

    expect(result.value).toBe('1015');
    expect(result.netCashFlow).toBe('1015');
    expect(result.totalInterestGenerated).toBe('0');
  });

  it('makes a complete period equal exactly to the contractual monthly rate', () => {
    const result = calculateLoanAtDate({
      loan: loan(),
      movements: [contribution('1')],
      asOfDate: '2026-10-01',
    });
    expect(result.value).toBe('1.0125');
  });

  it('implements the specified exponential rather than simple prorating', () => {
    const result = calculateLoanAtDate({
      loan: loan(),
      movements: [contribution('1000')],
      asOfDate: '2026-09-16',
    });
    const exponential = new Decimal('1000').times(
      new Decimal('1.0125').pow(new Decimal(15).div(30))
    );
    const simple = new Decimal('1000').times(
      new Decimal(1).plus(new Decimal('0.0125').times(new Decimal(15).div(30)))
    );

    expectDecimal(result.value, exponential);
    expect(new Decimal(result.value).equals(simple)).toBe(false);
  });

  it('retains decimal precision beyond binary floating point', () => {
    const result = calculateLoanAtDate({
      loan: loan({ rate: '0.00000000000000012345' }),
      movements: [contribution('999999999.99')],
      asOfDate: '2027-09-01',
    });

    const expected = expectedCompound('999999999.99', 12, '0.00000000000000012345');

    expectDecimal(result.value, expected, '1e-30');
    expect(result.value.split('.')[1].length).toBeGreaterThan(10);
    expect(new Decimal(result.value).greaterThan('999999999.99')).toBe(true);
    expectAccountingIdentities(result);
  });

  it('supports annual effective rate without changing the v1 capitalization model', () => {
    const result = calculateLoanAtDate({
      loan: loan({ rate: '0.10', rateType: 'annual_effective' }),
      movements: [contribution('1000')],
      asOfDate: '2027-09-01',
    });

    expectDecimal(result.value, '1100', '1e-34');
  });

  it('is deterministic and does not mutate inputs', () => {
    const input = {
      loan: loan(),
      movements: [withdrawal('125', '2026-10-15'), contribution('1000'), contribution('250', '2026-09-10')],
      asOfDate: '2027-01-01',
    };
    const snapshot = JSON.parse(JSON.stringify(input));

    const first = calculateLoanAtDate(input);
    const second = calculateLoanAtDate(input);

    expect(first).toEqual(second);
    expect(input).toEqual(snapshot);
  });
});

describe('projection', () => {
  it.each([
    ['2026-09-01', [contribution('1000')]],
    ['2026-09-16', [contribution('1000')]],
    ['2026-10-15', [contribution('1000'), contribution('250', '2026-10-10')]],
    ['2026-10-15', [contribution('1000'), withdrawal('100', '2026-10-10')]],
  ])('matches a direct maturity valuation from %s', (asOfDate, movements) => {
    const projection = projectLoanToMaturity({ loan: loan(), movements, asOfDate });
    const knownMovements = movements.filter((movement) => movement.effectiveDate <= asOfDate);
    const direct = calculateLoanAtDate({
      loan: loan(),
      movements: knownMovements,
      asOfDate: '2027-09-01',
    });

    expect(projection.projectedMaturityValue).toBe(direct.value);
  });

  it('ignores known future movements when projecting from an earlier date', () => {
    const projection = projectLoanToMaturity({
      loan: loan(),
      movements: [contribution('1000'), contribution('9000', '2026-12-01')],
      asOfDate: '2026-10-01',
    });
    const directWithoutFuture = calculateLoanAtDate({
      loan: loan(),
      movements: [contribution('1000')],
      asOfDate: '2027-09-01',
    });

    expect(projection.projectedMaturityValue).toBe(directWithoutFuture.value);
  });
});

describe('validation errors', () => {
  const validInput = () => ({
    loan: loan(),
    movements: [contribution('1000')],
    asOfDate: '2026-09-01',
  });

  it.each([
    ['INVALID_CURRENCY', (input) => { input.loan.currency = 'BTC'; }],
    ['INVALID_RATE', (input) => { input.loan.rate = '-0.01'; }],
    ['INVALID_MATURITY_DATE', (input) => { input.loan.maturityDate = input.loan.startDate; }],
    ['MOVEMENT_BEFORE_START', (input) => { input.movements[0].effectiveDate = '2026-08-31'; }],
    ['MOVEMENT_AFTER_MATURITY', (input) => { input.movements.push(contribution('1', '2027-09-02')); }],
    ['INVALID_MOVEMENT_AMOUNT', (input) => { input.movements[0].amount = '0'; }],
    ['INVALID_MOVEMENT_TYPE', (input) => { input.movements[0].type = 'payment'; }],
    ['INVALID_RATE_TYPE', (input) => { input.loan.rateType = 'tna'; }],
    ['INVALID_CAPITALIZATION_FREQUENCY', (input) => { input.loan.capitalizationFrequency = 'daily'; }],
    ['INVALID_CALCULATION_VERSION', (input) => { input.loan.calculationVersion = 'loan-v2'; }],
  ])('rejects %s deterministically', (code, mutate) => {
    const input = validInput();
    mutate(input);

    try {
      calculateLoanAtDate(input);
      throw new Error('Expected calculateLoanAtDate to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(LoanValidationError);
      expect(error.code).toBe(code);
    }
  });

  it('requires the initial contribution on startDate', () => {
    expect(() => calculateLoanAtDate({
      loan: loan(),
      movements: [contribution('1000', '2026-09-02')],
      asOfDate: '2026-09-02',
    })).toThrowError(expect.objectContaining({ code: 'MISSING_INITIAL_CONTRIBUTION' }));
  });
});
