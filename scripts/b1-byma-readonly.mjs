import { existsSync } from 'node:fs';
import { createBymaClient } from '../server/closing/byma.js';
import { GROUPS, normalize } from '../server/closing/model.js';

// Explicit read-only diagnostic: no Firestore imports and no filesystem writes.
if (!process.argv.includes('--allow-network')) throw new Error('Pass --allow-network for BYMA read-only requests');
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const client = createBymaClient();
const capturedAt = new Date().toISOString();
const art = (iso) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23' }).format(new Date(iso)) + ' ART';
const distribution = (values) => Object.fromEntries([...new Set(values)].sort()
  .map((value) => [value, values.filter((item) => item === value).length]));
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(capturedAt));
const results = await Promise.all(Object.keys(GROUPS).map(async (group) => {
  const requestedAt = new Date().toISOString();
  try {
    const body = await client.fetchGroup(group);
    const receivedAt = new Date().toISOString();
    const times = body.result.map((r) => String(r.broadcast_time ?? 'MISSING').padStart(6, '0'));
    const representative = new Set(['GGAL', 'YPFD', 'AAPL', 'SPY', 'AL30', 'GD30', 'AL30D', 'GD30D', 'AL30C', 'GD30C']);
    const rawSamples = [...new Set([...body.result.filter((r) => representative.has(r.symbol)),
      body.result.find((r) => r.closing_price > 0), body.result.find((r) => !(r.trade > 0))].filter(Boolean))]
      .map((r) => Object.fromEntries(['symbol', 'security_id', 'closing_price', 'previous_close', 'trade',
        'Date', 'broadcast_time', 'currency', 'settlPeriod', 'market', 'operativeForm', 'category', 'settlDate', 'trades']
        .map((field) => [field, r[field] ?? null])));
    const observations = body.result.flatMap((r) => normalize(r, group, date, capturedAt, 'readonly-diagnostic'));
    const kinds = {};
    for (const o of observations) {
      const key = `${o.priceType}:${o.status}:${o.reason}`;
      kinds[key] = (kinds[key] || 0) + 1;
    }
    const samples = ['CLOSING_PRICE', 'PREVIOUS_CLOSE'].map((type) => observations.find((o) => o.priceType === type && o.price > 0))
      .filter(Boolean).map(({ providerSymbol, price, priceType, priceDate, valuationDate, status, stale, reason, dateEvidence }) =>
        ({ providerSymbol, price, priceType, priceDate, valuationDate, status, stale, reason, dateEvidence }));
    return { group, rows: body.result.length, positiveClosingRows: body.result.filter((r) => r.closing_price > 0).length,
      requestedAt, requestedAtART: art(requestedAt), receivedAt, receivedAtART: art(receivedAt),
      positivePreviousRows: body.result.filter((r) => r.previous_close > 0).length,
      positiveTradeRows: body.result.filter((r) => r.trade > 0).length,
      dates: distribution(body.result.map((r) => String(r.Date ?? 'MISSING'))),
      broadcastTimes: { min: [...times].sort()[0] ?? null, max: [...times].sort().at(-1) ?? null,
        byHour: distribution(times.map((time) => /^([01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(time) ? time.slice(0, 2) : 'INVALID')) },
      rawSamples,
      fields: Object.keys(body.result[0] || {}).sort(), classifications: kinds, samples };
  } catch (error) { return { group, error: error.code || error.name, httpStatus: error.httpStatus || null }; }
}));
console.log(JSON.stringify({ capturedAt, valuationDate: date, writes: 0, results }, null, 2));
if (results.some((r) => r.error)) process.exitCode = 1;
