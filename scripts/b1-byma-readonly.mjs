import { existsSync } from 'node:fs';
import { createBymaClient } from '../server/closing/byma.js';
import { GROUPS, normalize } from '../server/closing/model.js';

// Explicit read-only diagnostic: no Firestore imports and no filesystem writes.
if (!process.argv.includes('--allow-network')) throw new Error('Pass --allow-network for BYMA read-only requests');
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const client = createBymaClient();
const capturedAt = new Date().toISOString();
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(capturedAt));
const results = await Promise.all(Object.keys(GROUPS).map(async (group) => {
  try {
    const body = await client.fetchGroup(group);
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
      fields: Object.keys(body.result[0] || {}).sort(), classifications: kinds, samples };
  } catch (error) { return { group, error: error.code || error.name, httpStatus: error.httpStatus || null }; }
}));
console.log(JSON.stringify({ capturedAt, valuationDate: date, writes: 0, results }, null, 2));
if (results.some((r) => r.error)) process.exitCode = 1;
