import {
  StrategyDecimal as D, STRATEGY_CURRENCIES, decimal, dateOnly, fail,
  normalizeLedger, positionKey,
} from './strategyModel.js';

const zeroCurrencies = () => Object.fromEntries(STRATEGY_CURRENCIES.map(code => [code, new D(0)]));
const strings = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.toFixed()]));

// Pure calculation: no database, broker balances, or input mutations.
export function calculateStrategyBalances({ opening, operations = [], asOfDate }) {
  const ledger = normalizeLedger(opening, operations);
  const cutoff = asOfDate == null ? null : dateOnly(asOfDate, 'asOfDate');
  if (cutoff && cutoff < ledger.opening.asOfDate) fail('DATE_BEFORE_OPENING', 'Fecha anterior al saldo inicial.');
  const cash = Object.fromEntries(Object.entries(ledger.opening.cash).map(([code, value]) => [code, new D(value)]));
  const realizedResult = zeroCurrencies();
  const netContributions = zeroCurrencies();
  const positions = new Map();

  ledger.opening.positions.forEach(position => {
    const key = positionKey(position);
    const existing = positions.get(key);
    if (existing && !existing.priceDivisor.eq(position.priceDivisor)) fail('INCONSISTENT_PRICE_DIVISOR', 'Cotización incompatible para el mismo activo.');
    positions.set(key, {
      ticker: position.ticker, currency: position.currency, priceDivisor: new D(position.priceDivisor),
      quantity: new D(position.quantity).plus(existing?.quantity ?? 0),
      costBasis: new D(position.costBasis).plus(existing?.costBasis ?? 0),
    });
  });

  for (const operation of ledger.operations) {
    if (cutoff && operation.tradeDate > cutoff) break;
    const code = operation.currency;
    if (['contribution', 'withdrawal'].includes(operation.type)) {
      const amount = new D(operation.amount).times(operation.type === 'contribution' ? 1 : -1);
      if (cash[code].plus(amount).isNegative()) fail('INSUFFICIENT_CASH', `Efectivo insuficiente: ${operation.id}.`);
      cash[code] = cash[code].plus(amount);
      netContributions[code] = netContributions[code].plus(amount);
      continue;
    }
    const key = positionKey(operation);
    const position = positions.get(key) ?? {
      ticker: operation.ticker, currency: code, priceDivisor: new D(operation.priceDivisor),
      quantity: new D(0), costBasis: new D(0),
    };
    if (!position.priceDivisor.eq(operation.priceDivisor)) fail('INCONSISTENT_PRICE_DIVISOR', 'Cotización incompatible para el mismo activo.');
    const quantity = new D(operation.quantity);
    const net = new D(operation.netAmount);
    if (operation.type === 'buy') {
      if (cash[code].lt(net)) fail('INSUFFICIENT_CASH', `Efectivo insuficiente: ${operation.id}.`);
      cash[code] = cash[code].minus(net);
      position.quantity = position.quantity.plus(quantity);
      position.costBasis = position.costBasis.plus(net);
    } else {
      if (position.quantity.lt(quantity)) fail('SALE_EXCEEDS_POSITION', `Venta superior al saldo de ${operation.ticker}: ${operation.id}.`);
      const costRemoved = quantity.eq(position.quantity)
        ? position.costBasis : position.costBasis.times(quantity).div(position.quantity);
      cash[code] = cash[code].plus(net);
      realizedResult[code] = realizedResult[code].plus(net.minus(costRemoved));
      position.quantity = position.quantity.minus(quantity);
      position.costBasis = position.costBasis.minus(costRemoved);
    }
    if (position.quantity.isZero()) positions.delete(key);
    else positions.set(key, position);
  }
  return {
    asOfDate: cutoff ?? ledger.operations.at(-1)?.tradeDate ?? ledger.opening.asOfDate,
    cash: strings(cash), realizedResult: strings(realizedResult), netContributions: strings(netContributions),
    positions: [...positions.values()].sort((a, b) => positionKey(a).localeCompare(positionKey(b))).map(position => ({
      ticker: position.ticker, currency: position.currency, priceDivisor: position.priceDivisor.toFixed(),
      quantity: position.quantity.toFixed(), costBasis: position.costBasis.toFixed(),
      averageCost: position.costBasis.div(position.quantity).toFixed(),
    })),
  };
}

// Explicit quotes keyed by "ticker:currency"; missing quotes never become zero.
export function valueStrategyBalances({ balances, prices }) {
  const marketValue = zeroCurrencies();
  const unrealizedResult = zeroCurrencies();
  for (const position of balances.positions) {
    const key = positionKey(position);
    if (prices?.[key] == null) fail('MISSING_PRICE', `Falta cotización para ${key}.`);
    const value = new D(position.quantity).times(decimal(prices[key], key)).div(position.priceDivisor);
    marketValue[position.currency] = marketValue[position.currency].plus(value);
    unrealizedResult[position.currency] = unrealizedResult[position.currency].plus(value.minus(position.costBasis));
  }
  return Object.fromEntries(STRATEGY_CURRENCIES.map(code => [code, {
    marketValue: marketValue[code].toFixed(), cash: balances.cash[code],
    equity: marketValue[code].plus(balances.cash[code]).toFixed(),
    realizedResult: balances.realizedResult[code], unrealizedResult: unrealizedResult[code].toFixed(),
    tradingResult: unrealizedResult[code].plus(balances.realizedResult[code]).toFixed(),
  }]));
}
