import Decimal from 'decimal.js';

export const STRATEGY_LEDGER_VERSION = 'strategy-v1';
export const STRATEGY_OPERATION_TYPES = Object.freeze({
  BUY: 'buy', SELL: 'sell', CONTRIBUTION: 'contribution', WITHDRAWAL: 'withdrawal',
});
export const STRATEGY_CURRENCIES = Object.freeze(['ARS', 'USD']);
export const StrategyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export class StrategyValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StrategyValidationError';
    this.code = code;
  }
}

export function fail(code, message) { throw new StrategyValidationError(code, message); }

// Canonical decimals only. Localized input belongs in the UI, before this boundary.
export function decimal(value, field, { positive = false } = {}) {
  if (!['string', 'number'].includes(typeof value) ||
      (typeof value === 'string' && !/^-?\d+(\.\d+)?$/.test(value))) {
    fail('INVALID_DECIMAL', `${field}: se requiere un decimal sin separadores de miles.`);
  }
  const result = new StrategyDecimal(value);
  if (!result.isFinite() || result.isNegative() || (positive && result.isZero())) {
    fail('INVALID_DECIMAL', `${field}: importe inválido.`);
  }
  return result;
}

export function dateOnly(value, field = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    fail('INVALID_DATE', `${field}: se requiere una fecha válida YYYY-MM-DD.`);
  }
  return value;
}

function currency(value) {
  const result = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!STRATEGY_CURRENCIES.includes(result)) fail('INVALID_CURRENCY', 'Moneda: ARS o USD.');
  return result;
}

function ticker(value) {
  const result = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!result || /[\s/:]/.test(result)) fail('INVALID_TICKER', 'Ticker inválido.');
  if (['ARS', 'PESOS', 'USD'].includes(result)) {
    fail('CASH_AS_SECURITY', 'Registrar el efectivo como aporte o retiro.');
  }
  return result;
}

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_OBJECT', `${field}: se requiere un objeto.`);
  }
}

function money(value, field) {
  const result = decimal(value, field);
  if (result.decimalPlaces() > 2) fail('INVALID_MONEY', `${field}: máximo dos decimales.`);
  return result;
}

function optionalText(value, field, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') fail('INVALID_TEXT', `${field}: se requiere texto.`);
  return value.trim();
}

export function positionKey(position) { return `${position.ticker}:${position.currency}`; }

export function normalizeOpening(opening) {
  object(opening, 'opening');
  if (opening.version !== STRATEGY_LEDGER_VERSION) fail('INVALID_VERSION', 'Versión del registro inválida.');
  if (opening.cash != null) object(opening.cash, 'cash');
  if (!Array.isArray(opening.positions)) fail('INVALID_POSITIONS', 'positions debe ser un arreglo.');
  const positions = opening.positions.map(position => {
    object(position, 'position');
    return {
      ticker: ticker(position.ticker), currency: currency(position.currency),
      quantity: decimal(position.quantity, 'quantity', { positive: true }).toFixed(),
      costBasis: decimal(position.costBasis, 'costBasis').toFixed(),
      priceDivisor: decimal(position.priceDivisor ?? '1', 'priceDivisor', { positive: true }).toFixed(),
    };
  });
  return {
    version: STRATEGY_LEDGER_VERSION, asOfDate: dateOnly(opening.asOfDate, 'opening.asOfDate'),
    positions, cash: Object.fromEntries(STRATEGY_CURRENCIES.map(code => [
      code, decimal(opening.cash?.[code] ?? '0', `cash.${code}`).toFixed(),
    ])),
  };
}

export function normalizeOperation(operation) {
  object(operation, 'operation');
  if (typeof operation.id !== 'string' || !operation.id.trim() || operation.id.includes('/')) {
    fail('INVALID_ID', 'La operación necesita un identificador único.');
  }
  if (!Object.values(STRATEGY_OPERATION_TYPES).includes(operation.type)) {
    fail('INVALID_OPERATION_TYPE', 'Tipo de operación inválido.');
  }
  if (!Number.isSafeInteger(operation.sequence) || operation.sequence < 0) {
    fail('INVALID_SEQUENCE', 'sequence define el orden de operaciones en la misma fecha.');
  }
  const tradeDate = dateOnly(operation.tradeDate, 'tradeDate');
  const settlementDate = operation.settlementDate == null ? null : dateOnly(operation.settlementDate, 'settlementDate');
  if (settlementDate && settlementDate < tradeDate) fail('INVALID_SETTLEMENT_DATE', 'Liquidación anterior a la operación.');
  const base = {
    id: operation.id.trim(), type: operation.type, tradeDate, settlementDate,
    sequence: operation.sequence, currency: currency(operation.currency),
    sourceOperationId: optionalText(operation.sourceOperationId, 'sourceOperationId'),
    broker: optionalText(operation.broker, 'broker'), note: optionalText(operation.note, 'note', ''),
  };
  if (['contribution', 'withdrawal'].includes(base.type)) {
    const amount = money(operation.amount, 'amount');
    if (amount.isZero()) fail('INVALID_AMOUNT', 'El movimiento debe tener un importe positivo.');
    return { ...base, amount: amount.toFixed(),
      ...(operation.usdRateAtTrade == null ? {} : { usdRateAtTrade: decimal(operation.usdRateAtTrade, 'Dólar del movimiento', { positive: true }).toFixed() }),
      ...(operation.benchmarkValueARSAtTrade == null ? {} : { benchmarkValueARSAtTrade: decimal(operation.benchmarkValueARSAtTrade, 'Referencia del movimiento', { positive: true }).toFixed() }),
    };
  }
  const quantity = decimal(operation.quantity, 'quantity', { positive: true });
  const price = decimal(operation.price, 'price');
  const divisor = decimal(operation.priceDivisor ?? '1', 'priceDivisor', { positive: true });
  const gross = quantity.times(price).div(divisor).toDecimalPlaces(2);
  const suppliedNet = operation.netAmount == null ? null : money(operation.netAmount, 'netAmount');
  const fees = operation.fees == null && suppliedNet !== null
    ? (base.type === 'buy' ? suppliedNet.minus(gross) : gross.minus(suppliedNet))
    : money(operation.fees ?? '0', 'fees');
  if (fees.isNegative()) fail('INVALID_NET_AMOUNT', 'El neto es incompatible con el bruto.');
  const net = base.type === 'buy' ? gross.plus(fees) : gross.minus(fees);
  if (net.isNegative() || (suppliedNet !== null && !suppliedNet.eq(net))) {
    fail('INVALID_NET_AMOUNT', 'El neto no coincide con el precio, cantidad y gastos.');
  }
  return {
    ...base, ticker: ticker(operation.ticker), quantity: quantity.toFixed(),
    price: price.toFixed(), priceDivisor: divisor.toFixed(),
    grossAmount: gross.toFixed(), fees: fees.toFixed(), netAmount: net.toFixed(),
  };
}

export function normalizeLedger(opening, operations) {
  const normalizedOpening = normalizeOpening(opening);
  if (!Array.isArray(operations)) fail('INVALID_OPERATIONS', 'operations debe ser un arreglo.');
  const ids = new Set();
  const sequences = new Set();
  const normalizedOperations = operations.map(normalizeOperation);
  normalizedOperations.forEach(operation => {
    if (operation.tradeDate < normalizedOpening.asOfDate) fail('OPERATION_BEFORE_OPENING', 'Operación anterior al saldo inicial.');
    if (ids.has(operation.id)) fail('DUPLICATE_OPERATION', 'Identificador de operación repetido.');
    ids.add(operation.id);
    const order = `${operation.tradeDate}:${operation.sequence}`;
    if (sequences.has(order)) fail('DUPLICATE_SEQUENCE', 'Dos operaciones tienen el mismo orden en la misma fecha.');
    sequences.add(order);
  });
  normalizedOperations.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.sequence - b.sequence);
  return { opening: normalizedOpening, operations: normalizedOperations };
}
