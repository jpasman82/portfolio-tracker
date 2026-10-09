import { calculateStrategyBalances } from './strategyEngine.js';
import { dateOnly, fail, normalizeOperation } from './strategyModel.js';

export function localStrategyDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function activeStrategyOperations(records) {
  return records.flatMap(record => {
    if (!['active', 'cancelled'].includes(record.status)) fail('INVALID_STATUS', 'Estado de operación inválido.');
    const operation = normalizeOperation(record);
    return record.status === 'active' ? [operation] : [];
  });
}

export function nextStrategySequence(records, tradeDate) {
  return records.filter(record => record.tradeDate === tradeDate)
    .reduce((max, record) => Math.max(max, record.sequence), 0) + 1000;
}

export function calculateStrategyLedger(opening, records) {
  return calculateStrategyBalances({ opening, operations: activeStrategyOperations(records) });
}

export function prepareStrategyOperation({ opening, records, input }) {
  const operation = normalizeOperation({ ...input, sequence: input.sequence ?? nextStrategySequence(records, input.tradeDate) });
  if (dateOnly(operation.tradeDate) > localStrategyDate()) fail('FUTURE_OPERATION', 'Registrar sólo operaciones ya concertadas.');
  if (records.some(record => record.id === operation.id)) fail('DUPLICATE_OPERATION', 'La operación ya está registrada.');
  if (records.some(record => record.tradeDate === operation.tradeDate && record.sequence === operation.sequence)) {
    fail('DUPLICATE_SEQUENCE', 'Ese orden del día ya está ocupado. Elegí un valor libre.');
  }
  if (operation.sourceOperationId && records.some(record => record.status === 'active'
    && record.sourceOperationId === operation.sourceOperationId && record.type === operation.type
    && record.ticker === operation.ticker && record.currency === operation.currency)) {
    fail('DUPLICATE_SOURCE_OPERATION', 'Ese boleto ya tiene una operación de este tipo y activo en la estrategia.');
  }
  const nextRecords = [...records, { ...operation, status: 'active' }];
  return { operation, balances: calculateStrategyLedger(opening, nextRecords) };
}

export function prepareStrategyCancellation({ opening, records, operationId, reason }) {
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
    fail('INVALID_REASON', 'Indicar un motivo de anulación de hasta 500 caracteres.');
  }
  const operation = records.find(record => record.id === operationId);
  if (!operation || operation.status !== 'active') fail('INVALID_CANCELLATION', 'La operación no existe o ya está anulada.');
  if (operation.linkedTransferId) fail('LINKED_TRANSFER', 'Esta operación forma parte de una transferencia entre estrategias. Corregir el conjunto para conservar ambos saldos.');
  const nextRecords = records.map(record => record.id === operationId ? { ...record, status: 'cancelled' } : record);
  return { reason: reason.trim(), balances: calculateStrategyLedger(opening, nextRecords) };
}
