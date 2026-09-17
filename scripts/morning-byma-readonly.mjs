import { existsSync } from 'node:fs';
import { createBymaClient } from '../server/closing/byma.js';
import { previousTradingSession } from '../server/closing/calendar.js';
import { normalizePreviousClose, selectPreviousClose, validateInformationDates } from '../server/closing/morning.js';
import { GROUPS } from '../server/closing/model.js';

// Explicit diagnostic boundary: BYMA reads only; no Firestore module, import or write.
if (!process.argv.includes('--allow-network')) throw new Error('Pass --allow-network for BYMA read-only requests');
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const now = new Date();
const informationDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);
const capturedAt = now.toISOString();
const valuationDate = previousTradingSession(informationDate);
const client = createBymaClient();
const responses = Object.fromEntries(await Promise.all(Object.keys(GROUPS).map(async (group) => [group, await client.fetchGroup(group)])));
const groupDates = validateInformationDates(responses, informationDate);
const observations = Object.keys(GROUPS).flatMap((group) => responses[group].result
  .map((row) => normalizePreviousClose(row, group, informationDate)));

const fixtureTickers = ['BBAR', 'BMA', 'CEPU', 'EDN', 'GGAL', 'GLOB', 'PAMP', 'SUPV', 'TECO2', 'TGSU2', 'VIST', 'YPFD'];
const fixtureCoverage = fixtureTickers.map((ticker) => {
  try {
    const selected = selectPreviousClose({ key: `acciones+cedears:${ticker}`,
      groups: ['acciones', 'cedears'], symbols: [ticker] }, observations);
    return { ticker, status: 'VALID', group: selected.group, previousClose: selected.price };
  } catch (error) {
    return { ticker, status: 'MISSING', reason: error.code };
  }
});
const mepArs = selectPreviousClose({ key: 'fx:MEP:ARS', groups: ['bonosARS'], symbols: ['AL30'] }, observations);
const mepUsd = selectPreviousClose({ key: 'fx:MEP:USD', groups: ['bonosUSD'], symbols: ['AL30D'] }, observations);
const groups = Object.fromEntries(Object.keys(GROUPS).map((group) => {
  const rows = responses[group].result;
  return [group, {
    rows: rows.length,
    positivePreviousClose: rows.filter((row) => Number.isFinite(row.previous_close) && row.previous_close > 0).length,
    missingPreviousCloseSymbols: rows.filter((row) => !(Number.isFinite(row.previous_close) && row.previous_close > 0))
      .map((row) => row.symbol).sort(),
    Date: groupDates[group],
  }];
}));

console.log(JSON.stringify({
  capturedAt,
  informationDate,
  valuationDate,
  writes: { Firestore: 0, portfolioDailySnapshots: 0, brokerPositions: 0 },
  groups,
  fixtureCoverage,
  mep: {
    arsLeg: { symbol: mepArs.providerSymbol, previousClose: mepArs.price, Date: mepArs.providerDate },
    usdLeg: { symbol: mepUsd.providerSymbol, previousClose: mepUsd.price, Date: mepUsd.providerDate },
    value: mepArs.price / mepUsd.price,
  },
}, null, 2));
