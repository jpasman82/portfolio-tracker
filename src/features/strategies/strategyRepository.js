import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp } from 'firebase/firestore';
import { calculateStrategyLedger, prepareStrategyOperation, prepareStrategyCancellation, localStrategyDate } from './strategyLedger';
import { createStrategyOpeningFromLegacy } from './strategyLegacy';
import { decimal, fail, normalizeOperation, normalizeOpening } from './strategyModel';
import { strategyMetrics } from './strategyUi';
import { strategyCashFlows } from './strategyCashFlows';
import { createInitialPortfolio } from './strategyInitialPortfolio';

function segment(value) {
  if (typeof value !== 'string' || !value.trim() || ['.', '..'].includes(value) || value.includes('/')) {
    fail('INVALID_ID', 'Identificador inválido.');
  }
  return value;
}
function revision(strategy) { return strategy.ledgerRevision ?? 0; }
function existing(snapshot) {
  if (!snapshot.exists()) fail('STRATEGY_NOT_FOUND', 'La estrategia ya no existe.');
  return { ...snapshot.data(), id: snapshot.id };
}
function sameRevision(strategy, expected) {
  if (revision(strategy) !== expected) fail('STALE_STRATEGY', 'La estrategia cambió en otra ventana. Actualizá y revisá la operación.');
}
function requireActive(strategy) {
  if (!strategy.ledgerOpening) fail('LEDGER_NOT_ACTIVE', 'Habilitar primero el historial de operaciones.');
  if (strategy.isClosed) fail('STRATEGY_CLOSED', 'Reabrir la estrategia para agregar o anular operaciones.');
}
function balancePatch(strategy, records, balances) {
  return {
    ledgerCashFlows: strategyCashFlows(records),
    ledgerBalances: balances, ledgerRevision: revision(strategy) + 1,
    ledgerOperationCount: records.length,
    ledgerActiveCount: records.filter(record => record.status === 'active').length,
    ledgerUpdatedAt: serverTimestamp(),
  };
}

export function createStrategyRepository(db) {
  const strategyRef = id => doc(db, 'rotations', segment(id));
  const operationsRef = id => collection(strategyRef(id), 'operations');

  async function load(id) {
    const reference = strategyRef(id);
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = existing(await getDoc(reference));
      if (!before.ledgerOpening) return { strategy: before, records: [], balances: null };
      const snapshot = await getDocs(operationsRef(id));
      const after = existing(await getDoc(reference));
      if (revision(before) !== revision(after)) continue;
      const records = snapshot.docs.map(item => ({ ...item.data(), id: item.id }))
        .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.sequence - b.sequence);
      return { strategy: { ...after, ledgerCashFlows: strategyCashFlows(records) }, records, balances: calculateStrategyLedger(after.ledgerOpening, records) };
    }
    fail('STALE_STRATEGY', 'La estrategia está cambiando. Volvé a actualizar.');
  }

  async function activate(id, openingInput, actorUid) {
    segment(actorUid);
    const opening = normalizeOpening(openingInput);
    if (opening.asOfDate > localStrategyDate()) fail('FUTURE_OPENING', 'La fecha de apertura no puede ser futura.');
    return runTransaction(db, async transaction => {
      const reference = strategyRef(id);
      const strategy = existing(await transaction.get(reference));
      if (strategy.ledgerOpening) fail('LEDGER_ALREADY_ACTIVE', 'El historial ya está habilitado. Actualizá la página.');
      if (strategy.isClosed) fail('STRATEGY_CLOSED', 'Reabrir la estrategia antes de habilitar el historial.');
      if (strategy.tradeDate && opening.asOfDate < strategy.tradeDate) fail('DATE_BEFORE_OPENING', 'El corte no puede ser anterior al inicio de la estrategia.');
      const currentOpening = createStrategyOpeningFromLegacy(strategy, { asOfDate: opening.asOfDate });
      if (JSON.stringify(currentOpening) !== JSON.stringify(opening)) fail('STALE_STRATEGY', 'Las cantidades o costos cambiaron. Actualizá antes de habilitar el historial.');
      const balances = calculateStrategyLedger(opening, []);
      transaction.update(reference, {
        ...(!strategy.initialPortfolio && createInitialPortfolio(strategy) ? { initialPortfolio: createInitialPortfolio(strategy) } : {}),
        ledgerOpening: opening, ledgerOpeningRecordedAt: serverTimestamp(), ledgerOpeningRecordedBy: actorUid,
        ...balancePatch(strategy, [], balances),
      });
      return balances;
    });
  }

  async function addOperation(id, input, expectedRevision, actorUid) {
    segment(actorUid);
    segment(input.id);
    const ledger = await load(id);
    requireActive(ledger.strategy);
    const duplicate = ledger.records.find(record => record.id === input.id);
    if (duplicate) {
      if (duplicate.status === 'active' && JSON.stringify(normalizeOperation(duplicate)) === JSON.stringify(normalizeOperation(input))) return;
      fail('DUPLICATE_OPERATION', 'Ese identificador ya está registrado.');
    }
    sameRevision(ledger.strategy, expectedRevision);
    const prepared = prepareStrategyOperation({ opening: ledger.strategy.ledgerOpening, records: ledger.records, input });
    const records = [...ledger.records, { ...prepared.operation, status: 'active' }];
    return runTransaction(db, async transaction => {
      const reference = strategyRef(id);
      const operationRef = doc(operationsRef(id), input.id);
      const strategy = existing(await transaction.get(reference));
      const operationSnapshot = await transaction.get(operationRef);
      sameRevision(strategy, expectedRevision);
      requireActive(strategy);
      if (operationSnapshot.exists()) fail('DUPLICATE_OPERATION', 'La operación ya está registrada.');
      transaction.set(operationRef, {
        ...prepared.operation, status: 'active', recordedAt: serverTimestamp(), recordedBy: actorUid,
      });
      transaction.update(reference, balancePatch(strategy, records, prepared.balances));
    });
  }

  async function cancelOperation(id, operationId, reason, expectedRevision, actorUid) {
    segment(actorUid);
    segment(operationId);
    const ledger = await load(id);
    requireActive(ledger.strategy);
    sameRevision(ledger.strategy, expectedRevision);
    const prepared = prepareStrategyCancellation({ opening: ledger.strategy.ledgerOpening, records: ledger.records, operationId, reason });
    const records = ledger.records.map(record => record.id === operationId ? { ...record, status: 'cancelled' } : record);
    return runTransaction(db, async transaction => {
      const reference = strategyRef(id);
      const operationRef = doc(operationsRef(id), operationId);
      const strategy = existing(await transaction.get(reference));
      const operation = await transaction.get(operationRef);
      sameRevision(strategy, expectedRevision);
      requireActive(strategy);
      if (!operation.exists() || operation.data().status !== 'active') fail('INVALID_CANCELLATION', 'La operación ya está anulada.');
      transaction.update(operationRef, {
        status: 'cancelled', cancelledAt: serverTimestamp(), cancelledBy: actorUid, cancellationReason: prepared.reason,
      });
      transaction.update(reference, balancePatch(strategy, records, prepared.balances));
    });
  }

  async function saveSettings(id, input, expectedRevision) {
    const name = input.eventName?.trim();
    if (!name || name.length > 120) fail('INVALID_NAME', 'Nombre de estrategia: entre 1 y 120 caracteres.');
    const usdRate = decimal(input.usdRate, 'Dólar', { positive: true }).toFixed();
    const normalizePrices = prices => Object.fromEntries(Object.entries(prices).map(([key, value]) => [key, decimal(value, 'Precio').toFixed()]));
    const prices = normalizePrices(input.prices);
    const soldPrices = normalizePrices(input.soldPrices);
    const initialPrices = normalizePrices(input.initialPrices ?? {});
    return runTransaction(db, async transaction => {
      const reference = strategyRef(id);
      const strategy = existing(await transaction.get(reference));
      sameRevision(strategy, expectedRevision);
      if (!strategy.ledgerOpening) fail('LEDGER_NOT_ACTIVE', 'El historial no está habilitado.');
      const metrics = strategyMetrics(strategy, { prices, soldPrices, initialPrices, usdRate });
      const now = new Date();
      const date = now.toLocaleString('es-AR');
      const historyEntry = {
        date, timestampIso: now.toISOString(), valuationDate: metrics.valuationDate, usdRate, prices, soldPrices, initialPrices,
        ledgerBalances: strategy.ledgerBalances, ledgerRevision: revision(strategy),
        totalARS: metrics.totalARS, totalUSD: metrics.totalUSD,
        benchmarkUSD: metrics.benchmarkUSD, deltaUSD: metrics.deltaUSD, alphaPP: metrics.pALFA,
        ...(metrics.initialPortfolio ? { initialPortfolioUSD: metrics.initialPortfolio.totalUSD } : {}),
      };
      transaction.update(reference, {
        eventName: name, currentPricesFromDb: prices, soldCurrentPricesFromDb: soldPrices,
        initialPortfolioPricesFromDb: initialPrices,
        currentUsdRateFromDb: usdRate, isClosed: Boolean(input.isClosed),
        valuationDate: metrics.valuationDate,
        lastUpdated: date, priceHistory: [...(strategy.priceHistory ?? []), historyEntry],
        ledgerRevision: revision(strategy) + 1, ledgerUpdatedAt: serverTimestamp(),
      });
    });
  }

  return { load, activate, addOperation, cancelOperation, saveSettings };
}

// A stale legacy page cannot overwrite quantities after activation in another tab.
export async function saveLegacyStrategySnapshot(db, id, patch) {
  return runTransaction(db, async transaction => {
    const reference = doc(db, 'rotations', segment(id));
    const strategy = existing(await transaction.get(reference));
    if (strategy.ledgerOpening) fail('LEDGER_ALREADY_ACTIVE', 'Esta estrategia ya usa historial. Actualizá la página para registrar operaciones.');
    transaction.update(reference, patch);
  });
}

export async function deleteLegacyStrategy(db, id) {
  return runTransaction(db, async transaction => {
    const reference = doc(db, 'rotations', segment(id));
    const strategy = existing(await transaction.get(reference));
    if (strategy.ledgerOpening) fail('LEDGER_ALREADY_ACTIVE', 'Esta estrategia tiene historial. Se puede cerrar, pero no borrar desde esta pantalla.');
    transaction.delete(reference);
  });
}
