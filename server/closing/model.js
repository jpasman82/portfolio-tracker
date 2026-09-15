import { createHash } from 'node:crypto';

export const VERSION = 'b1-v1';
export const TIMEZONE = 'America/Argentina/Buenos_Aires';
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

// User clarification: Date/broadcast_time date the updated traded quote, with
// broadcast_time in Argentina local HHmmss. This is user-provided semantics,
// NOT an official BYMA certification of closing_price or previous_close dates.
// Closing-price semantics remain fail-closed. No environment-variable bypass.
export const BYMA_DATE_CONTRACT = Object.freeze({
  version: 'byma-user-trade-date-v1',
  resolve: (row, field) => field === 'trade'
    ? { priceDate: row.Date || null, reference: 'user-clarification://portfolio-tracker/2026-09-15/traded-quote',
      reason: 'USER_PROVIDED_TRADE_DATE_SEMANTICS' }
    : { priceDate: null, reference: null, reason: 'UNVERIFIED_PRICE_DATE' },
});

export function normalize(row, group, valuationDate, capturedAt, attemptId, contract = BYMA_DATE_CONTRACT) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
  const spec = GROUPS[group];
  const identity = {
    providerSymbol: String(row.symbol || '').trim().toUpperCase(),
    securityId: row.security_id == null ? null : String(row.security_id),
    segment: spec.group, currency: String(row.currency || spec.currency),
    market: String(row.market || spec.market || 'UNKNOWN'),
    settlement: String(row.settlPeriod || '0002'),
    operativeForm: row.operativeForm == null ? 'UNKNOWN' : String(row.operativeForm),
    requestedMarket: spec.market || null, requestedOperativeForm: 'CONTADO',
    quoteUnit: spec.type === 'fixed_income' ? 'PER_100_NOMINAL' : 'PER_UNIT',
  };
  // Response enums are not request enums: real BYMA rows use operativeForm=C
  // and market=CT even for requests with CONTADO / PPT. Keep both dimensions;
  // never relabel CT as PPT or use request values to erase provider identity.
  const mismatch = identity.currency !== spec.currency || identity.settlement !== '0002';
  const quoteKey = hash(identity);
  return [['closing_price', 'CLOSING_PRICE'], ['previous_close', 'PREVIOUS_CLOSE'], ['trade', 'TRADE']]
    .filter(([field]) => row[field] !== undefined)
    .map(([field, priceType]) => {
      let evidence;
      try { evidence = contract.resolve(row, field, group) || {}; }
      catch { evidence = { priceDate: null, reference: null, reason: 'DATE_CONTRACT_ERROR' }; }
      const price = typeof row[field] === 'number' && Number.isFinite(row[field]) ? row[field] : null;
      const knownDate = typeof evidence.priceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(evidence.priceDate)
        && evidence.reference ? evidence.priceDate : null;
      const reason = !identity.providerSymbol || !identity.securityId || mismatch ? 'INVALID_IDENTITY'
        : !(price > 0) ? 'INVALID_PRICE'
          : priceType !== 'CLOSING_PRICE' ? 'NOT_CURRENT_CLOSING_PRICE'
            : !knownDate ? 'UNVERIFIED_PRICE_DATE'
              : knownDate !== valuationDate ? 'WRONG_SESSION' : null;
      const stable = { ...identity, quoteKey, group, valuationDate, priceDate: knownDate,
        price, priceType, source: 'BYMA', status: reason ? 'REJECTED' : 'VALID', reason,
        stale: priceType === 'PREVIOUS_CLOSE' || (knownDate ? knownDate !== valuationDate : null),
        dateEvidence: { contractVersion: contract.version, reference: evidence.reference || null,
          reason: evidence.reason || null, providerDate: row.Date == null ? null : String(row.Date),
          broadcastTime: row.broadcast_time == null ? null : String(row.broadcast_time) },
        normalizerVersion: VERSION };
      return { ...stable, id: hash(stable), capturedAt, attemptId };
    });
}

export function selectRequirement(requirement, observations) {
  const candidates = observations.filter((o) => requirement.groups.includes(o.group)
    && requirement.symbols.includes(o.providerSymbol) && o.status === 'VALID');
  const quotes = new Map();
  for (const o of candidates) {
    // Repeated identical rows are harmless; different values or identities are
    // ambiguous, even if their symbols happen to match.
    quotes.set(`${o.quoteKey}:${o.price}`, o);
  }
  if (quotes.size !== 1) return { observation: null, reason: quotes.size ? 'AMBIGUOUS_QUOTE' : 'MISSING_VALID_CLOSE' };
  return { observation: [...quotes.values()][0], reason: null };
}
