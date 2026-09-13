const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year, month) {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new Error(`Invalid year: ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}`);
  }

  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseDateOnly(value, fieldName = 'date') {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must use YYYY-MM-DD`);
  }

  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    throw new Error(`${fieldName} must use YYYY-MM-DD`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`${fieldName} is not a valid calendar date`);
  }

  return { year, month, day };
}

export function toDateOnly({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function toEpochDay(value) {
  const { year, month, day } = parseDateOnly(value);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.trunc(date.getTime() / MS_PER_DAY);
}

export function compareDateOnly(left, right) {
  parseDateOnly(left, 'left date');
  parseDateOnly(right, 'right date');
  return left < right ? -1 : left > right ? 1 : 0;
}

export function daysBetween(startDate, endDate) {
  const days = toEpochDay(endDate) - toEpochDay(startDate);
  if (days < 0) {
    throw new Error('endDate must be on or after startDate');
  }
  return days;
}

export function addMonthsAnchored(startDate, monthOffset, anchorDay = parseDateOnly(startDate).day) {
  const start = parseDateOnly(startDate, 'startDate');
  if (!Number.isInteger(monthOffset) || monthOffset < 0) {
    throw new Error('monthOffset must be a non-negative integer');
  }
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    throw new Error('anchorDay must be an integer between 1 and 31');
  }

  const absoluteMonth = start.year * 12 + (start.month - 1) + monthOffset;
  const year = Math.floor(absoluteMonth / 12);
  const month = (absoluteMonth % 12) + 1;
  const day = Math.min(anchorDay, daysInMonth(year, month));
  return toDateOnly({ year, month, day });
}

export function minDateOnly(...values) {
  if (values.length === 0) throw new Error('At least one date is required');
  values.forEach((value) => parseDateOnly(value));
  return values.reduce((minimum, value) => (value < minimum ? value : minimum));
}
