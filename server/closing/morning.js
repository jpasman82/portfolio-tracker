import { calendarTrace, CALENDAR_STATES, classifyBymaDate, previousTradingSession } from './calendar.js';
import { updatePositionsAndBuildSnapshot } from './legacy.js';
import { GROUPS, hash, number } from './model.js';

export const MORNING_POLICY_VERSION = 'morning-previous-close-v1';
export const MORNING_PRICE_POLICY = 'BYMA_SNAPSHOT_PREVIOUS_CLOSE';
export const MORNING_SOURCE = 'vercel-cron-morning-previous-close';
export const VALUATION_SCOPE = Object.freeze({ name: 'BROKERS_ONLY', collection: 'brokerPositions' });

const EXPECTED_CATEGORY = Object.freeze({ acciones: 1, cedears: 23, bonosARS: 3, bonosUSD: 3, bonosEXT: 3 });
const EXCLUDED_BY_EXISTING_VALUATION = new Set(['XP', 'NU', 'PAX', 'VALE', 'ITUB', 'EWZ']);
const fail = (code, details = null) => Object.assign(new Error(code), { code, details });
const bond = (ticker) => /^[A-Z]{2,3}\d{2}[A-Z]?$/i.test(ticker);

export function freezeMorningInputs(positions) {
  if (!Array.isArray(positions) || positions.length === 0) throw fail('EMPTY_POSITIONS');
  const requirements = new Map();
  const add = (key, groups, symbols) => {
    requirements.set(key, { key, groups, symbols });
    return key;
  };
  add('fx:MEP:ARS', ['bonosARS'], ['AL30']);
  add('fx:MEP:USD', ['bonosUSD'], ['AL30D']);
  const bindings = [];
  const frozenPositions = positions.map(({ id, data, updateTime = null }) => {
    if (!id || !data || typeof data !== 'object') throw fail('INVALID_INPUT');
    return {
      id: String(id),
      updateTime,
      data: {
        debt: data.debt == null || data.debt === '' ? 0 : number(data.debt, `${id}:debt`),
        assets: (data.assets || []).map((asset) => {
          const quantity = number(asset?.quantity, `${id}:quantity`);
          const ticker = String(asset?.ticker || '').trim().toUpperCase();
          if (quantity !== 0 && !ticker) throw fail('INVALID_INPUT');
          const isBond = Boolean(asset?.isBond || bond(ticker));
          if (quantity !== 0 && !EXCLUDED_BY_EXISTING_VALUATION.has(ticker)) {
            const nativeUsdBond = id === 'jpm' && isBond;
            const providerSymbol = nativeUsdBond && ticker === 'TFU27' ? 'TU27D' : ticker;
            const groups = nativeUsdBond ? ['bonosUSD'] : isBond ? ['bonosARS'] : ['acciones', 'cedears'];
            const key = add(`${groups.join('+')}:${providerSymbol}`, groups, [providerSymbol]);
            bindings.push({ brokerId: String(id), ticker, quantity, key,
              providerSymbol, convertToUSD: id === 'jpm' && !nativeUsdBond });
          }
          // Cached client price/rate is deliberately excluded from historical inputs.
          return { ticker, quantity, isBond };
        }),
      },
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  bindings.sort((a, b) => `${a.brokerId}:${a.ticker}`.localeCompare(`${b.brokerId}:${b.ticker}`));
  const core = {
    sourceCollection: VALUATION_SCOPE.collection,
    valuationScope: VALUATION_SCOPE.name,
    policyVersion: MORNING_POLICY_VERSION,
    positions: frozenPositions,
    bindings,
    requirements: [...requirements.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
  return { ...core, inputHash: hash(core) };
}

export function validateInformationDates(responses, informationDate) {
  const groupDates = {};
  for (const group of Object.keys(GROUPS)) {
    const rows = responses[group]?.result;
    if (!Array.isArray(rows) || rows.length === 0) throw fail('BYMA_GROUP_DATE_MISSING', { group });
    const dates = [...new Set(rows.map((row) => row && typeof row === 'object' ? String(row.Date ?? '') : ''))].sort();
    if (dates.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(dates[0])) {
      throw fail('BYMA_GROUP_DATE_INCONSISTENT', { group, dates });
    }
    if (dates[0] !== informationDate) {
      throw fail('BYMA_INFORMATION_DATE_MISMATCH', { group, expected: informationDate, actual: dates[0] });
    }
    groupDates[group] = dates[0];
  }
  return groupDates;
}

export function normalizePreviousClose(row, group, informationDate) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || !GROUPS[group]) {
    return { status: 'REJECTED', reason: 'INVALID_ROW', group, providerSymbol: null };
  }
  const spec = GROUPS[group];
  const providerSymbol = String(row.symbol || '').trim().toUpperCase();
  const currency = String(row.currency ?? 'UNKNOWN');
  const market = String(row.market ?? 'UNKNOWN');
  const settlement = String(row.settlPeriod ?? 'UNKNOWN');
  const operativeForm = String(row.operativeForm ?? 'UNKNOWN');
  const securityId = row.security_id == null ? null : String(row.security_id);
  const category = typeof row.category === 'number' ? row.category : null;
  const providerDate = row.Date == null ? null : String(row.Date);
  const price = typeof row.previous_close === 'number' && Number.isFinite(row.previous_close)
    ? row.previous_close : null;
  const identity = {
    providerSymbol,
    securityId,
    segment: spec.group,
    currency,
    market,
    settlement,
    operativeForm,
    requestedMarket: spec.market || null,
    requestedOperativeForm: 'CONTADO',
    category,
    quoteUnit: spec.type === 'fixed_income' ? 'PER_100_NOMINAL' : 'PER_UNIT',
  };
  const identityMismatch = !providerSymbol || !securityId || currency !== spec.currency
    || settlement !== '0002' || market !== 'CT' || operativeForm !== 'C'
    || category !== EXPECTED_CATEGORY[group]
    || securityId !== `${providerSymbol}-0002-C-CT-${currency}`;
  const reason = identityMismatch ? 'INVALID_IDENTITY'
    : providerDate !== informationDate ? 'WRONG_INFORMATION_DATE'
      : !(price > 0) ? 'MISSING_PREVIOUS_CLOSE' : null;
  return {
    ...identity,
    group,
    providerDate,
    informationDate,
    price,
    priceType: 'PREVIOUS_CLOSE',
    source: 'BYMA_SNAPSHOT',
    pricePolicy: MORNING_PRICE_POLICY,
    policyVersion: MORNING_POLICY_VERSION,
    quoteKey: hash(identity),
    status: reason ? 'REJECTED' : 'VALID',
    reason,
    broadcastTime: row.broadcast_time == null ? null : String(row.broadcast_time),
  };
}

export function selectPreviousClose(requirement, observations) {
  const relevant = observations.filter((observation) => requirement.groups.includes(observation.group)
    && requirement.symbols.includes(observation.providerSymbol));
  const valid = relevant.filter((observation) => observation.status === 'VALID');
  if (!valid.length) throw fail('MISSING_REQUIRED_PREVIOUS_CLOSE', {
    key: requirement.key,
    reasons: [...new Set(relevant.map((observation) => observation.reason).filter(Boolean))].sort(),
  });
  const quoteKeys = new Set(valid.map((observation) => observation.quoteKey));
  const prices = new Set(valid.map((observation) => observation.price));
  if (quoteKeys.size !== 1 || prices.size !== 1) throw fail('AMBIGUOUS_PREVIOUS_CLOSE', { key: requirement.key });
  return valid[0];
}

function missingRequirementDetail(requirement, observations, bindings, error) {
  const relevant = observations.filter((observation) => requirement.groups.includes(observation.group)
    && requirement.symbols.includes(observation.providerSymbol));
  const rejectionReasons = relevant.map((observation) => observation.reason).filter(Boolean);
  const reasons = [...new Set([
    ...(relevant.length ? rejectionReasons : ['BYMA_ROW_NOT_FOUND']),
    ...(error.code === 'AMBIGUOUS_PREVIOUS_CLOSE' ? ['AMBIGUOUS_PREVIOUS_CLOSE'] : []),
  ])].sort();
  return {
    requirementKey: requirement.key,
    ticker: requirement.symbols[0] || null,
    providerSymbols: requirement.symbols,
    groups: requirement.groups,
    positions: bindings.filter((binding) => binding.key === requirement.key).map((binding) => ({
      broker: binding.brokerId,
      quantity: binding.quantity,
      localTicker: binding.ticker,
      providerSymbol: binding.providerSymbol,
    })),
    reasons,
    candidates: relevant.map((observation) => ({
      providerSymbol: observation.providerSymbol,
      group: observation.group,
      previousClose: observation.price,
      providerDate: observation.providerDate,
      status: observation.status,
      reason: observation.reason,
      currency: observation.currency,
      settlement: observation.settlement,
      market: observation.market,
      operativeForm: observation.operativeForm,
      category: observation.category,
      securityId: observation.securityId,
    })),
  };
}

export async function buildMorningSnapshot({ informationDate, capturedAt, positions, responses }) {
  const informationDay = classifyBymaDate(informationDate);
  if (informationDay.state === 'UNKNOWN') throw fail('CALENDAR_UNKNOWN');
  if (![CALENDAR_STATES.TRADING, CALENDAR_STATES.LIMITED_WITH_TRADING].includes(informationDay.state)) {
    throw fail('INFORMATION_DATE_NOT_TRADING');
  }
  const valuationDate = previousTradingSession(informationDate);
  const groupDates = validateInformationDates(responses, informationDate);
  const input = freezeMorningInputs(positions);
  const observations = Object.keys(GROUPS).flatMap((group) => responses[group].result
    .map((row) => normalizePreviousClose(row, group, informationDate)));
  const selected = new Map();
  const missing = [];
  for (const requirement of input.requirements) {
    try {
      selected.set(requirement.key, selectPreviousClose(requirement, observations));
    } catch (error) {
      if (!['MISSING_REQUIRED_PREVIOUS_CLOSE', 'AMBIGUOUS_PREVIOUS_CLOSE'].includes(error.code)) throw error;
      missing.push(missingRequirementDetail(requirement, observations, input.bindings, error));
    }
  }
  if (missing.length) throw fail('MISSING_REQUIRED_PREVIOUS_CLOSE', { missing });
  const mepArs = selected.get('fx:MEP:ARS');
  const mepUsd = selected.get('fx:MEP:USD');
  const mep = mepArs.price / mepUsd.price;
  if (!(mep > 0) || !Number.isFinite(mep)) throw fail('INVALID_MEP');
  const assetPrices = new Map(input.bindings.map((binding) => {
    const price = selected.get(binding.key).price;
    return [`${binding.brokerId}:${binding.ticker}`, binding.convertToUSD ? price / mep : price];
  }));
  const { positionUpdates: _ignoredPositionUpdates, ...calculated } = await updatePositionsAndBuildSnapshot({
    positions: input.positions,
    valuationDate,
    capturedAt,
    marketData: { prices: {}, usdBondSymbols: new Set(), mep, cable: null },
    priceForAsset: (brokerId, ticker) => assetPrices.get(`${brokerId}:${ticker}`),
  });
  if (Object.values(calculated.totals).some((value) => !Number.isFinite(value))) throw fail('INVALID_VALUATION');
  const priceObservations = [...selected.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, observation]) => ({
    key,
    group: observation.group,
    providerSymbol: observation.providerSymbol,
    previousClose: observation.price,
    providerDate: observation.providerDate,
    currency: observation.currency,
    market: observation.market,
    settlement: observation.settlement,
    operativeForm: observation.operativeForm,
    category: observation.category,
    securityId: observation.securityId,
    quoteUnit: observation.quoteUnit,
  }));
  const buildId = hash({
    informationDate,
    valuationDate,
    inputHash: input.inputHash,
    priceObservations,
    policyVersion: MORNING_POLICY_VERSION,
  });
  return {
    ...calculated,
    date: valuationDate,
    valuationDate,
    informationDate,
    source: MORNING_SOURCE,
    capturedAt,
    updatedAt: capturedAt,
    isComplete: true,
    economicStatus: 'COMPLETE',
    valuationScope: VALUATION_SCOPE.name,
    inputSource: VALUATION_SCOPE.collection,
    inputHash: input.inputHash,
    policyVersion: MORNING_POLICY_VERSION,
    pricePolicy: MORNING_PRICE_POLICY,
    priceSource: 'BYMA_SNAPSHOT',
    dailyPriceDefinition: 'previous_close observed on the following BYMA information date',
    groupDates,
    calendar: calendarTrace(informationDate, valuationDate),
    rates: { ...calculated.rates, mepSource: { ars: 'AL30', usd: 'AL30D', priceType: 'PREVIOUS_CLOSE' } },
    priceObservations,
    b1BuildId: buildId,
    morningBuildId: buildId,
  };
}

function samePublication(existing, snapshot) {
  return existing?.source === MORNING_SOURCE
    && existing?.pricePolicy === MORNING_PRICE_POLICY
    && existing?.policyVersion === MORNING_POLICY_VERSION
    && existing?.valuationDate === snapshot.valuationDate
    && existing?.informationDate === snapshot.informationDate
    && existing?.inputHash === snapshot.inputHash
    && existing?.morningBuildId === snapshot.morningBuildId;
}

export async function publishMorningSnapshot(store, snapshot) {
  const path = `portfolioDailySnapshots/${snapshot.valuationDate}`;
  const existing = await store.get(path);
  if (existing) {
    if (!samePublication(existing.data, snapshot)) throw fail('EXISTING_SNAPSHOT_CONFLICT');
    return { publicationStatus: 'NOOP', snapshot: existing.data };
  }
  try {
    await store.commit([{ path, data: snapshot }]);
    return { publicationStatus: 'PUBLISHED', snapshot };
  } catch (error) {
    // Reconcile a concurrent identical create or an uncertain commit ACK.
    const after = await store.get(path);
    if (after && samePublication(after.data, snapshot)) return { publicationStatus: 'NOOP', snapshot: after.data };
    if (after) throw fail('EXISTING_SNAPSHOT_CONFLICT');
    throw error;
  }
}

export async function runMorning({ informationDate, store, byma, loadPositions,
  now = () => new Date().toISOString(), log = (entry) => console.info(JSON.stringify(entry)) }) {
  const capturedAt = now();
  const valuationDate = previousTradingSession(informationDate);
  log({ event: 'morning_valuation_started', informationDate, valuationDate,
    policyVersion: MORNING_POLICY_VERSION, valuationScope: VALUATION_SCOPE.name });
  const positions = await loadPositions();
  const entries = await Promise.all(Object.keys(GROUPS).map(async (group) => {
    try {
      return [group, await byma.fetchGroup(group)];
    } catch (error) {
      throw Object.assign(error, { group });
    }
  }));
  const responses = Object.fromEntries(entries);
  const snapshot = await buildMorningSnapshot({ informationDate, capturedAt, positions, responses });
  const published = await publishMorningSnapshot(store, snapshot);
  log({ event: 'morning_valuation_complete', informationDate, valuationDate,
    publicationStatus: published.publicationStatus, buildId: snapshot.morningBuildId });
  return {
    status: 'COMPLETE',
    stage: published.publicationStatus,
    publicationStatus: published.publicationStatus,
    informationDate,
    valuationDate,
    prices: snapshot.priceObservations.length,
    brokers: snapshot.brokers.length,
    mep: snapshot.rates.mep,
    buildId: snapshot.morningBuildId,
  };
}
