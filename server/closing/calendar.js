const fail = (code) => Object.assign(new Error(code), { code });

export const CALENDAR_STATES = Object.freeze({
  TRADING: 'TRADING',
  LIMITED_WITH_TRADING: 'LIMITED_WITH_TRADING',
  CLOSED: 'CLOSED',
});

// BYMA distinguishes national/no-trading holidays from days without settlement
// that retain trading. Every date in the covered year is classified by the
// explicit exception table plus the weekday/weekend rule below.
export const BYMA_CALENDAR = Object.freeze({
  version: 'byma-trading-calendar-2026-v1',
  years: Object.freeze([2026]),
  source: 'https://www.byma.com.ar/mercado/calendario-bursatil',
  reviewedAt: '2026-09-17',
  notice: 'BYMA states that the calendar can change following official resolutions.',
});

const SPECIAL_DATES = Object.freeze({
  '2026-01-01': Object.freeze({ state: CALENDAR_STATES.CLOSED, reason: 'Año Nuevo' }),
  '2026-02-16': Object.freeze({ state: CALENDAR_STATES.CLOSED, reason: 'Carnaval' }),
  '2026-02-17': Object.freeze({ state: CALENDAR_STATES.CLOSED, reason: 'Carnaval' }),
  '2026-03-23': Object.freeze({ state: CALENDAR_STATES.LIMITED_WITH_TRADING, reason: 'Sin liquidación; con negociación' }),
  '2026-03-24': Object.freeze({ state: CALENDAR_STATES.CLOSED, reason: 'Día Nacional de la Memoria' }),
  '2026-04-02': Object.freeze({ state: CALENDAR_STATES.CLOSED, reason: 'Día del Veterano y de los Caídos en Malvinas' }),
  '2026-04-03': Object.freeze({ state: CALENDAR_STATES.CLOSED, reason: 'Viernes Santo' }),
  '2026-05-01': Object.freeze({ state: CALENDAR_STATES.CLOSED, reason: 'Día del Trabajador' }),
  '2026-05-25': Object.freeze({ state: CALENDAR_STATES.CLOSED, reason: 'Día de la Revolución de Mayo' }),
  '2026-06-15': Object.freeze({ state: CALENDAR_STATES.CLOSED, reason: 'Paso a la Inmortalidad de Martín Miguel de Güemes' }),
  '2026-07-09': Object.freeze({ state: CALENDAR_STATES.CLOSED, reason: 'Día de la Independencia' }),
  '2026-07-10': Object.freeze({ state: CALENDAR_STATES.LIMITED_WITH_TRADING, reason: 'Sin liquidación; con negociación' }),
  '2026-08-17': Object.freeze({ state: CALENDAR_STATES.CLOSED, reason: 'Paso a la Inmortalidad de José de San Martín' }),
  '2026-10-12': Object.freeze({ state: CALENDAR_STATES.CLOSED, reason: 'Día del Respeto a la Diversidad Cultural' }),
  '2026-11-06': Object.freeze({ state: CALENDAR_STATES.LIMITED_WITH_TRADING, reason: 'Día del Bancario: sin liquidación; con negociación' }),
  '2026-11-23': Object.freeze({ state: CALENDAR_STATES.CLOSED, reason: 'Día de la Soberanía Nacional' }),
  '2026-12-07': Object.freeze({ state: CALENDAR_STATES.LIMITED_WITH_TRADING, reason: 'Sin liquidación; con negociación' }),
  '2026-12-08': Object.freeze({ state: CALENDAR_STATES.CLOSED, reason: 'Inmaculada Concepción de María' }),
  '2026-12-24': Object.freeze({ state: CALENDAR_STATES.LIMITED_WITH_TRADING, reason: 'Nochebuena: sin liquidación; con negociación' }),
  '2026-12-25': Object.freeze({ state: CALENDAR_STATES.CLOSED, reason: 'Navidad' }),
  '2026-12-31': Object.freeze({ state: CALENDAR_STATES.CLOSED, reason: 'Sin negociación ni liquidación' }),
});

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value) => typeof value === 'string' && DATE_ONLY.test(value)
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function classifyBymaDate(date) {
  if (!validDate(date)) return Object.freeze({ date, state: 'UNKNOWN', reason: 'INVALID_DATE' });
  const year = Number(date.slice(0, 4));
  if (!BYMA_CALENDAR.years.includes(year)) {
    return Object.freeze({ date, state: 'UNKNOWN', reason: 'YEAR_NOT_COVERED' });
  }
  if (SPECIAL_DATES[date]) return Object.freeze({ date, ...SPECIAL_DATES[date] });
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) {
    return Object.freeze({ date, state: CALENDAR_STATES.CLOSED, reason: 'WEEKEND' });
  }
  return Object.freeze({ date, state: CALENDAR_STATES.TRADING, reason: 'REGULAR_SESSION' });
}

export function previousTradingSession(informationDate) {
  const informationDay = classifyBymaDate(informationDate);
  if (informationDay.state === 'UNKNOWN') throw fail('CALENDAR_UNKNOWN');
  const cursor = new Date(`${informationDate}T12:00:00Z`);
  for (let days = 0; days < 370; days += 1) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const candidate = cursor.toISOString().slice(0, 10);
    const classification = classifyBymaDate(candidate);
    if (classification.state === 'UNKNOWN') throw fail('CALENDAR_UNKNOWN');
    if ([CALENDAR_STATES.TRADING, CALENDAR_STATES.LIMITED_WITH_TRADING].includes(classification.state)) {
      return candidate;
    }
  }
  throw fail('CALENDAR_UNKNOWN');
}

export function calendarTrace(informationDate, valuationDate) {
  return {
    version: BYMA_CALENDAR.version,
    source: BYMA_CALENDAR.source,
    reviewedAt: BYMA_CALENDAR.reviewedAt,
    informationDate: classifyBymaDate(informationDate),
    valuationDate: classifyBymaDate(valuationDate),
  };
}
