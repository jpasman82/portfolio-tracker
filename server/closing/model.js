import { createHash } from 'node:crypto';

export const VERSION = 'b1-snapshot-last-trade-v2';
export const TIMEZONE = 'America/Argentina/Buenos_Aires';
export const PRICE_POLICY = 'BYMA_SNAPSHOT_LAST_TRADE';
export const TRADE_REFERENCE = 'https://jira-tecval.atlassian.net/wiki/external/NTQ0OTRmYzBlMTUzNGFlOTg1MTFkMzI2OWIzYTM1MTc';
export const CAPTURE_POLICY = Object.freeze({ cutoffART: '18:00', version: 'post-wheel-art-v1' });
// Only a later cutoff can be configured without revising the reviewed minimum.
export function capturePolicy(env = process.env) {
  const cutoffART = env.PORTFOLIO_CAPTURE_CUTOFF_ART ?? CAPTURE_POLICY.cutoffART;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoffART) || cutoffART < CAPTURE_POLICY.cutoffART) {
    throw Object.assign(new Error('INVALID_CAPTURE_CUTOFF'), { code: 'INVALID_CAPTURE_CUTOFF' });
  }
  return { ...CAPTURE_POLICY, cutoffART };
}
const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function captureWindowReason(date, capturedAt, policy = CAPTURE_POLICY) {
  if (!validDate(date)) return 'INVALID_VALUATION_DATE';
  if (!policy || policy.version !== CAPTURE_POLICY.version
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(policy.cutoffART) || policy.cutoffART < CAPTURE_POLICY.cutoffART) return 'INVALID_CAPTURE_CUTOFF';
  if (typeof capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(capturedAt)
    || !Number.isFinite(Date.parse(capturedAt))) return 'INVALID_CAPTURE_TIME';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(capturedAt)).map((part) => [part.type, part.value]));
  if (`${parts.year}-${parts.month}-${parts.day}` !== date) return 'WRONG_CAPTURE_SESSION';
  if ([0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay())) return 'NON_TRADING_WEEKDAY';
  return `${parts.hour}:${parts.minute}` < policy.cutoffART ? 'BEFORE_CAPTURE_CUTOFF' : null;
}
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const GROUPS = Object.freeze({
  acciones: { type: 'equity', group: 'ACCIONES', currency: 'ARS' },
  cedears: { type: 'equity', group: 'CEDEARS', currency: 'ARS' },
  bonosARS: { type: 'fixed_income', group: 'TITULOSPUBLICOS', currency: 'ARS', market: 'PPT' },
  bonosUSD: { type: 'fixed_income', group: 'TITULOSPUBLICOS', currency: 'USD', market: 'PPT' },
  bonosEXT: { type: 'fixed_income', group: 'TITULOSPUBLICOS', currency: 'EXT', market: 'PPT' },
});
export function endpoint(group) {
  const { type, ...query } = GROUPS[group];
  return `/snapshot/v1/${type}?${new URLSearchParams({ ...query, operativeForm: 'CONTADO', settlPeriod: '0002' })}`;
}

export function number(value, label) {
  // Preserve the application's Argentine numeric input convention, but reject
  // malformed/missing quantities instead of silently converting them to zero.
  const parsed = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value.replace(/\./g, '').replace(',', '.')) : NaN;
  if (!Number.isFinite(parsed)) throw Object.assign(new Error(label), { code: 'INVALID_INPUT' });
  return parsed;
}

const EXCLUDED = new Set(['XP', 'NU', 'PAX', 'VALE', 'ITUB', 'EWZ']);
const bond = (ticker) => /^[A-Z]{2,3}\d{2}[A-Z]?$/i.test(ticker);
export function freezeInputs(positions, capturedAt) {
  if (!positions.length) throw Object.assign(new Error('No broker positions'), { code: 'EMPTY_POSITIONS' });
  const requirements = new Map();
  const add = (key, groups, symbols) => {
    requirements.set(key, { key, groups, symbols });
    return key;
  };
  add('fx:MEP:ARS', ['bonosARS'], ['AL30']);
  add('fx:MEP:USD', ['bonosUSD'], ['AL30D', 'AL30']);
  const bindings = [];
  const frozen = positions.map(({ id, data, updateTime = null }) => ({
    id, updateTime,
    data: {
      debt: data.debt == null || data.debt === '' ? 0 : number(data.debt, `${id}:debt`),
      assets: (data.assets || []).map((asset) => {
        const quantity = number(asset?.quantity, `${id}:quantity`);
        const ticker = String(asset?.ticker || '').trim().toUpperCase();
        if (quantity !== 0 && !ticker) throw Object.assign(new Error('Missing ticker'), { code: 'INVALID_INPUT' });
        const isBond = Boolean(asset?.isBond || bond(ticker));
        if (quantity !== 0 && !EXCLUDED.has(ticker)) {
          const nativeUSD = id === 'jpm' && isBond;
          const symbol = nativeUSD && ticker === 'TFU27' ? 'TU27D' : ticker;
          const groups = nativeUSD ? ['bonosUSD'] : isBond ? ['bonosARS'] : ['acciones', 'cedears'];
          const key = add(`${groups.join('+')}:${symbol}`, groups, [symbol]);
          bindings.push({ brokerId: id, ticker, key, convertToUSD: id === 'jpm' && !nativeUSD });
        }
        return { ticker, quantity, isBond }; // Deliberately no cached price/rate.
      }),
    },
  })).sort((a, b) => a.id.localeCompare(b.id));
  const input = { capturedAt, source: 'first-successful-read-not-market-close', positions: frozen,
    bindings, requirements: [...requirements.values()].sort((a, b) => a.key.localeCompare(b.key)), policyVersion: VERSION };
  return { ...input, inputHash: hash(input) };
}

// Business contract: row Date + positive operation count is the evidence for
// that day's last trade. broadcast_time is only the time of the last update,
// NOT an execution timestamp and NOT evidence of an official BYMA close.
export function normalize(row, group, valuationDate, capturedAt, attemptId, policy = CAPTURE_POLICY) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
  const spec = GROUPS[group];
  const identity = {
    providerSymbol: String(row.symbol || '').trim().toUpperCase(),
    securityId: row.security_id == null ? null : String(row.security_id),
    segment: spec.group, currency: String(row.currency ?? 'UNKNOWN'),
    market: String(row.market ?? 'UNKNOWN'),
    settlement: String(row.settlPeriod ?? 'UNKNOWN'),
    operativeForm: row.operativeForm == null ? 'UNKNOWN' : String(row.operativeForm),
    requestedMarket: spec.market || null, requestedOperativeForm: 'CONTADO',
    quoteUnit: spec.type === 'fixed_income' ? 'PER_100_NOMINAL' : 'PER_UNIT',
  };
  // Response enums are not request enums: real BYMA rows use operativeForm=C
  // and market=CT even for requests with CONTADO / PPT. Keep both dimensions;
  // never relabel CT as PPT or use request values to erase provider identity.
  const category = typeof row.category === 'number' ? row.category : null;
  const expectedCategory = { acciones: 1, cedears: 23, bonosARS: 3, bonosUSD: 3, bonosEXT: 3 }[group];
  const mismatch = identity.currency !== spec.currency || identity.settlement !== '0002'
    || identity.market !== 'CT' || identity.operativeForm !== 'C' || category !== expectedCategory
    || identity.securityId !== `${identity.providerSymbol}-0002-C-CT-${identity.currency}`;
  const tradeCount = Number.isSafeInteger(row.trades) && row.trades >= 0 ? row.trades : null;
  const providerDate = row.Date == null ? null : String(row.Date);
  const windowReason = captureWindowReason(valuationDate, capturedAt, policy);
  const quoteKey = hash(identity);
  return [['closing_price', 'CLOSING_PRICE'], ['previous_close', 'PREVIOUS_CLOSE'], ['trade', 'TRADE']]
    .filter(([field]) => field === 'trade' || row[field] !== undefined)
    .map(([field, priceType]) => {
      const price = typeof row[field] === 'number' && Number.isFinite(row[field]) ? row[field] : null;
      const knownDate = priceType === 'TRADE' && validDate(providerDate) && tradeCount > 0 && price > 0 ? providerDate : null;
      const reason = !identity.providerSymbol || !identity.securityId || mismatch ? 'INVALID_IDENTITY'
        : priceType !== 'TRADE' ? 'REFERENCE_ONLY'
          : !validDate(providerDate) ? 'UNKNOWN_TRADE_DATE'
            : providerDate !== valuationDate ? 'WRONG_SESSION'
              : row.trade == null || price === 0 || tradeCount === 0 ? 'NO_TRADE'
                : !(price > 0) ? 'INVALID_PRICE'
                  : tradeCount === null ? 'UNKNOWN_TRADE_COUNT'
                    : windowReason;
      const stable = { ...identity, quoteKey, group, valuationDate, priceDate: knownDate,
        providerDate, tradeCount, category, price, priceType, source: 'BYMA_SNAPSHOT', pricePolicy: PRICE_POLICY,
        captureCutoffART: policy?.cutoffART ?? null, status: reason ? 'REJECTED' : 'VALID', reason,
        stale: priceType === 'PREVIOUS_CLOSE' || (knownDate ? knownDate !== valuationDate : null),
        dateEvidence: { contractVersion: VERSION, reference: TRADE_REFERENCE,
          basis: 'ROW_DATE_AND_POSITIVE_TRADE_COUNT', captureWindowVersion: policy?.version ?? null,
          providerDate, tradeCount,
          broadcastTime: row.broadcast_time == null ? null : String(row.broadcast_time) },
        normalizerVersion: VERSION };
      return { ...stable, id: hash(stable), capturedAt, attemptId };
    });
}

export function eligibleObservation(o, date) {
  const spec = GROUPS[o?.group];
  return Boolean(spec && o.status === 'VALID' && o.priceType === 'TRADE' && o.source === 'BYMA_SNAPSHOT'
    && o.pricePolicy === PRICE_POLICY && o.normalizerVersion === VERSION && o.dateEvidence?.contractVersion === VERSION
    && o.dateEvidence.reference === TRADE_REFERENCE && o.dateEvidence.basis === 'ROW_DATE_AND_POSITIVE_TRADE_COUNT'
    && o.providerDate === date && o.priceDate === date && o.valuationDate === date
    && Number.isSafeInteger(o.tradeCount) && o.tradeCount > 0 && o.dateEvidence.tradeCount === o.tradeCount
    && o.dateEvidence.providerDate === o.providerDate && Number.isFinite(o.price) && o.price > 0
    && o.currency === spec.currency && o.market === 'CT' && o.operativeForm === 'C' && o.settlement === '0002'
    && o.segment === spec.group && o.category === ({ acciones: 1, cedears: 23, bonosARS: 3, bonosUSD: 3, bonosEXT: 3 }[o.group])
    && o.securityId === `${o.providerSymbol}-0002-C-CT-${o.currency}`
    && !captureWindowReason(date, o.capturedAt, { cutoffART: o.captureCutoffART, version: o.dateEvidence.captureWindowVersion }));
}

export function selectRequirement(requirement, observations, date) {
  const relevant = observations.filter((o) => requirement.groups.includes(o.group) && requirement.symbols.includes(o.providerSymbol));
  const candidates = relevant.filter((o) => eligibleObservation(o, date));
  // Preserve the first eligible post-cutoff capture even if the worker died
  // before checkpointing its selection. Never choose between conflicting identities.
  if (new Set(candidates.map((o) => o.quoteKey)).size > 1) return { observation: null, reason: 'AMBIGUOUS_QUOTE' };
  candidates.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const firstTime = candidates.length ? Date.parse(candidates[0].capturedAt) : null;
  const quotes = new Map();
  for (const o of candidates.filter((o) => Date.parse(o.capturedAt) === firstTime)) {
    // Repeated identical rows are harmless; different values or identities are
    // ambiguous, even if their symbols happen to match.
    quotes.set(`${o.quoteKey}:${o.price}`, o);
  }
  if (quotes.size !== 1) {
    const latest = relevant.filter((o) => o.priceType === 'TRADE').sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
    return { observation: null, reason: quotes.size ? 'AMBIGUOUS_QUOTE' : latest?.reason || 'MISSING_VALID_TRADE' };
  }
  return { observation: [...quotes.values()][0], reason: null };
}
