/* global process */
import fs from 'node:fs/promises';
import path from 'node:path';
import { StrategyDecimal as D, decimal, dateOnly, normalizeOpening } from '../src/features/strategies/strategyModel.js';
import { prepareStrategyOperation, calculateStrategyLedger } from '../src/features/strategies/strategyLedger.js';
import { strategyMetrics } from '../src/features/strategies/strategyUi.js';
import { PROJECT, OUTPUT, documents, decodeFields, hash, readJson, writeJson, apiClient, buildPlan, writeFor, brokerVersions } from './import-strategy-sales.mjs';

const STRATEGY_ID = 'rotacion-usa-acciones-argentinas-2026-10-01';
const IMPORT_ID = 'balanz-rotation-2026-10-01';
const audit = { status: 'active', recordedBy: 'codex-import', recordedVia: 'codex-desktop', importId: IMPORT_ID };

function makePlan(draft, receipt, snapshot) {
  if (draft.version !== 'strategy-rotation-draft-v1' || draft.projectId !== PROJECT) throw new Error('Borrador no admitido.');
  const baseDate = dateOnly(draft.valuationBase.date);
  const rate = decimal(draft.valuationBase.usdRateARSPerUSD, 'MEP base', { positive: true });
  if (snapshot.strategies.some(s => s.id === STRATEGY_ID)) throw new Error('La rotación ya existe. Revisar los registros antes de repetir la importación.');
  const sales = buildPlan(receipt, snapshot);
  const totalPurchases = draft.purchases.reduce((sum, buy) => sum.plus(decimal(buy.netAmount, 'Neto compra')), new D(0));
  const totalSales = new D(sales.totals.receiptNet);
  const financing = totalPurchases.minus(totalSales);
  if (financing.isNegative() || !financing.eq(draft.funding.assignedAmountARS)) throw new Error('La financiación no coincide con la diferencia de los boletos.');
  const caucionUSD = financing.div(rate);
  if (!caucionUSD.eq(draft.benchmark.cashUSD)) throw new Error('El nominal USD de referencia no coincide con el MEP base.');
  const sourceFunding = [];
  for (const strategy of sales.strategies) {
    const amount = strategy.newRecords.reduce((sum, record) => sum.plus(record.netAmount), new D(0)).toFixed();
    strategy.newRecords = strategy.newRecords.map(record => ({ ...record, linkedTransferId: IMPORT_ID }));
    const prepared = prepareStrategyOperation({ opening: strategy.opening, records: [...strategy.existingRecords, ...strategy.newRecords], input: {
      id: `${IMPORT_ID}-out-${strategy.id}`, type: 'withdrawal', tradeDate: baseDate,
      currency: 'ARS', amount, broker: 'balanz',
      note: 'Transferencia del neto de las ventas a Rotación USA a acciones argentinas. No modifica saldos globales.',
    } });
    strategy.newRecords.push({ ...prepared.operation, ...audit, linkedTransferId: IMPORT_ID, transferDestinationStrategyId: STRATEGY_ID });
    strategy.afterBalances = prepared.balances;
    sourceFunding.push({ strategyId: strategy.id, strategyName: strategy.name, operationId: prepared.operation.id, currency: 'ARS', amount });
  }
  const funded = sourceFunding.reduce((sum, item) => sum.plus(item.amount), new D(0)).plus(sales.totals.unassignedNet).plus(financing);
  if (!funded.eq(totalPurchases)) throw new Error('Las fuentes no conservan el capital asignado.');
  const opening = normalizeOpening({ version: 'strategy-v1', asOfDate: baseDate, positions: [], cash: { ARS: totalPurchases.toFixed(), USD: '0' } });
  const newRecords = [];
  const boughtGross = new Map();
  const seenTickets = new Set();
  draft.purchases.forEach((buy, index) => {
    if (buy.currency !== 'ARS' || buy.tradeDate !== baseDate) throw new Error('Fecha o moneda de compra distinta a la confirmada.');
    if (buy.ticket && seenTickets.has(buy.ticket)) throw new Error('Boleto de compra repetido.');
    if (buy.ticket) seenTickets.add(buy.ticket);
    const prepared = prepareStrategyOperation({ opening, records: newRecords, input: {
      id: `${IMPORT_ID}-buy-${String(index + 1).padStart(2, '0')}-${buy.ticker}`,
      type: 'buy', tradeDate: baseDate, settlementDate: buy.settlementDate, ticker: buy.ticker,
      currency: 'ARS', quantity: buy.quantity, price: new D(buy.grossAmount).div(buy.quantity).toFixed(),
      netAmount: buy.netAmount, sourceOperationId: buy.ticket, broker: 'balanz',
      note: 'Compra del comprobante. Fecha agrupada y dólar base común según confirmación del usuario. Precio equivalente del bruto; costo incluye gastos.',
    } });
    if (!new D(prepared.operation.grossAmount).eq(buy.grossAmount)) throw new Error('Precio equivalente inconsistente.');
    newRecords.push({ ...prepared.operation, ...audit, sourceReceipt: {
      sourceFile: buy.sourceFile, ticket: buy.ticket, ticketCandidate: buy.ticketCandidate ?? null,
      quantity: buy.quantity, grossAmount: buy.grossAmount, netAmount: buy.netAmount,
      originalTradeDate: buy.sourceFile === receipt.sourceFile ? receipt.tradeDate : null,
      settlementDate: buy.settlementDate, groupedTradeDateRequested: baseDate,
    } });
    const previous = boughtGross.get(buy.ticker) ?? { quantity: new D(0), gross: new D(0) };
    boughtGross.set(buy.ticker, { quantity: previous.quantity.plus(buy.quantity), gross: previous.gross.plus(buy.grossAmount) });
  });
  const balances = calculateStrategyLedger(opening, newRecords);
  if (!new D(balances.cash.ARS).isZero()) throw new Error('El efectivo resultante no coincide con la financiación exacta.');
  for (const expected of draft.positionSummary) {
    const position = balances.positions.find(p => p.ticker === expected.ticker);
    if (!position || !new D(position.quantity).eq(expected.quantity) || !new D(position.costBasis).eq(expected.netCost)) throw new Error(`Posición inconsistente para ${expected.ticker}.`);
  }
  if (balances.positions.length !== draft.positionSummary.length) throw new Error('Cantidad de posiciones inconsistente.');
  const prices = Object.fromEntries([...boughtGross].map(([ticker, item]) => [`${ticker}:ARS`, item.gross.div(item.quantity).toFixed()]));
  const soldAssets = receipt.sales.map(sale => ({ ticker: sale.ticker, quantity: sale.quantity, priceAtTrade: new D(sale.grossAmount).div(sale.quantity).toFixed() }));
  const soldPrices = Object.fromEntries(soldAssets.map(asset => [asset.ticker, asset.priceAtTrade]));
  const parentFields = {
    clientId: snapshot.strategies.find(s => s.id === sales.strategies[0].id)?.data.clientId ?? 'cliente_001',
    eventName: 'Rotación USA a acciones argentinas · Octubre 2026', tradeDate: baseDate, isClosed: false,
    initialUsdRate: rate.toFixed(), currentUsdRateFromDb: rate.toFixed(), initialCapitalARS: totalPurchases.toFixed(),
    soldAssets, boughtAssets: balances.positions.map(position => ({ ticker: position.ticker, quantity: position.quantity,
      priceAtTrade: position.averageCost, usdRateAtTrade: rate.toFixed() })),
    currentPricesFromDb: prices, soldCurrentPricesFromDb: soldPrices, priceHistory: [],
    benchmarkCash: { ARS: '0', USD: caucionUSD.toFixed() },
    funding: { source: 'caucion-USD', assignedAmountARS: financing.toFixed(), equivalentAssignedAmountUSD: caucionUSD.toFixed(),
      conversionRate: rate.toFixed(), rateSource: draft.valuationBase.sourceUrl, salesNetARS: totalSales.toFixed(),
      sourceTransfers: sourceFunding, salesOutsideTrackedStrategies: sales.unassigned, interestIncluded: false,
      note: 'Nominal USD equivalente asignado a esta rotación, no saldo total ni principal de caución comprobado. Saldos globales independientes.' },
    sourceReceipts: draft.sources, groupedDateRequested: true,
    ledgerOpening: opening, ledgerOpeningRecordedBy: 'codex-import', ledgerBalances: balances,
    ledgerRevision: 1, ledgerOperationCount: newRecords.length, ledgerActiveCount: newRecords.length, ledgerLastImportId: IMPORT_ID,
  };
  const metrics = strategyMetrics(parentFields, { prices, soldPrices, usdRate: rate.toFixed() });
  return { version: 'strategy-rotation-plan-v1', projectId: PROJECT, importId: IMPORT_ID, draft, receipt,
    strategies: sales.strategies, newStrategy: { id: STRATEGY_ID, name: parentFields.eventName, parentFields, newRecords, afterBalances: balances },
    salesOutsideTrackedStrategies: sales.unassigned, totals: { salesNetARS: totalSales.toFixed(), purchasesNetARS: totalPurchases.toFixed(),
      caucionAssignedARS: financing.toFixed(), caucionEquivalentUSD: caucionUSD.toFixed(), initialCapitalUSD: metrics.initialUSD, cashAfterARS: balances.cash.ARS },
  };
}

function fingerprint(plan) { return hash({ strategies: plan.strategies, newStrategy: plan.newStrategy, totals: plan.totals }); }
async function applyPlan(plan, api) {
  if (plan.version !== 'strategy-rotation-plan-v1' || plan.projectId !== PROJECT) throw new Error('Plan no admitido.');
  const before = await api.snapshot();
  const recalculated = makePlan(plan.draft, plan.receipt, before);
  if (fingerprint(plan) !== fingerprint(recalculated)) throw new Error('Plan desactualizado. Preparar de nuevo antes de guardar.');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeJson(path.join(OUTPUT, `rotation-before-${stamp}.json`), { plan, snapshot: before });
  const writes = [];
  for (const strategy of plan.strategies) {
    const records = [...strategy.existingRecords, ...strategy.newRecords];
    const fields = { ledgerBalances: strategy.afterBalances, ledgerRevision: strategy.expectedRevision + 1,
      ledgerOperationCount: records.length, ledgerActiveCount: records.filter(record => record.status === 'active').length,
      ledgerLastImportId: IMPORT_ID,
      ...(strategy.activatesOpening ? { ledgerOpening: strategy.opening, ledgerOpeningRecordedBy: 'codex-import' } : {}),
    };
    writes.push(writeFor(`${documents}/rotations/${strategy.id}`, fields, { updateTime: strategy.expectedUpdateTime },
      ['ledgerUpdatedAt', ...(strategy.activatesOpening ? ['ledgerOpeningRecordedAt'] : [])]));
    for (const record of strategy.newRecords) writes.push(writeFor(`${documents}/rotations/${strategy.id}/operations/${record.id}`, record, { exists: false }, ['recordedAt']));
  }
  const created = plan.newStrategy;
  writes.push(writeFor(`${documents}/rotations/${created.id}`, created.parentFields, { exists: false }, ['ledgerOpeningRecordedAt', 'ledgerUpdatedAt', 'createdAt']));
  for (const record of created.newRecords) writes.push(writeFor(`${documents}/rotations/${created.id}/operations/${record.id}`, record, { exists: false }, ['recordedAt']));
  if (writes.length > 500 || writes.some(w => !w.update.name.startsWith(`${documents}/rotations/`))) throw new Error('Escrituras fuera del alcance admitido.');
  const response = await api.request(`${documents}:commit`, { writes });
  await writeJson(path.join(OUTPUT, `rotation-commit-${stamp}.json`), { importId: IMPORT_ID, response });
  const after = await api.snapshot();
  const verification = [...plan.strategies, created].map(expected => {
    const persisted = after.strategies.find(s => s.id === expected.id);
    if (!persisted) return { id: expected.id, matchesPlan: false, matchesCache: false };
    const records = persisted.operations.map(document => ({ ...decodeFields(document.fields), id: document.name.split('/').at(-1) }));
    const balances = calculateStrategyLedger(persisted.data.ledgerOpening, records);
    return { id: expected.id, name: persisted.data.eventName, operationCount: records.length,
      matchesPlan: hash(balances) === hash(expected.afterBalances), matchesCache: hash(balances) === hash(persisted.data.ledgerBalances), balances };
  });
  const touched = new Set(verification.map(v => v.id));
  const result = { commitTime: response.commitTime, writes: writes.length, strategyId: created.id, totals: plan.totals, verification,
    brokerVersionsUnchanged: hash(brokerVersions(before.brokers)) === hash(brokerVersions(after.brokers)),
    otherStrategiesUnchanged: before.strategies.filter(s => !touched.has(s.id)).every(s => after.strategies.find(a => a.id === s.id)?.document.updateTime === s.document.updateTime),
  };
  await writeJson(path.join(OUTPUT, `rotation-after-${stamp}.json`), { result, snapshot: after });
  console.log(JSON.stringify(result, null, 2));
  if (verification.some(v => !v.matchesPlan || !v.matchesCache)) throw new Error('La carga se guardó, pero necesita revisar la lectura posterior. No repetir el alta.');
}

async function main() {
  const [mode, file, receiptFile] = process.argv.slice(2);
  if (!['--preview', '--apply'].includes(mode) || !file) throw new Error('Uso: --preview borrador.json ventas.json | --apply plan.json');
  await fs.mkdir(OUTPUT, { recursive: true });
  const api = await apiClient();
  const input = await readJson(file);
  if (mode === '--apply') return applyPlan(input, api);
  if (!receiptFile) throw new Error('Falta el manifiesto de ventas confirmado.');
  const receipt = await readJson(receiptFile);
  const snapshot = await api.snapshot();
  const plan = makePlan(input, receipt, snapshot);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const planFile = path.join(OUTPUT, `rotation-plan-${stamp}.json`);
  await writeJson(path.join(OUTPUT, `rotation-backup-${stamp}.json`), snapshot);
  await writeJson(planFile, plan);
  console.log(JSON.stringify({ planFile, writes: plan.strategies.reduce((sum, s) => sum + 1 + s.newRecords.length, 0) + 1 + plan.newStrategy.newRecords.length,
    totals: plan.totals, strategies: plan.strategies.map(s => ({ name: s.name, operations: s.newRecords.length, cashAfterARS: s.afterBalances.cash.ARS })),
    newStrategy: { id: plan.newStrategy.id, name: plan.newStrategy.name, operations: plan.newStrategy.newRecords.length, positions: plan.newStrategy.afterBalances.positions } }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
