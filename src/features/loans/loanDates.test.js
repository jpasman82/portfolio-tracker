import { describe, expect, it } from 'vitest';
import {
  addMonthsAnchored,
  compareDateOnly,
  daysBetween,
  daysInMonth,
  isLeapYear,
  parseDateOnly,
  toEpochDay,
} from './loanDates';

describe('loanDates', () => {
  it('validates strict date-only ISO values', () => {
    expect(parseDateOnly('2026-09-01')).toEqual({ year: 2026, month: 9, day: 1 });
    expect(() => parseDateOnly('2026-9-1')).toThrow('YYYY-MM-DD');
    expect(() => parseDateOnly('2026-02-29')).toThrow('valid calendar date');
  });

  it('handles leap years using the Gregorian rules', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it.each([
    ['2026-01-28', '2026-02-28', '2026-03-28'],
    ['2024-01-29', '2024-02-29', '2024-03-29'],
    ['2026-01-29', '2026-02-28', '2026-03-29'],
    ['2026-01-30', '2026-02-28', '2026-03-30'],
    ['2026-01-31', '2026-02-28', '2026-03-31'],
    ['2024-01-31', '2024-02-29', '2024-03-31'],
  ])('preserves the original anchor for %s', (start, first, second) => {
    expect(addMonthsAnchored(start, 1)).toBe(first);
    expect(addMonthsAnchored(start, 2)).toBe(second);
  });

  it('uses UTC epoch days and calendar-day differences', () => {
    expect(daysBetween('2026-09-01', '2026-10-01')).toBe(30);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(toEpochDay('2026-09-01') + 30).toBe(toEpochDay('2026-10-01'));
  });

  it('compares dates without local timezone behavior', () => {
    expect(compareDateOnly('2026-09-01', '2026-09-01')).toBe(0);
    expect(compareDateOnly('2026-09-01', '2026-09-02')).toBe(-1);
    expect(compareDateOnly('2026-10-01', '2026-09-30')).toBe(1);
  });
});
