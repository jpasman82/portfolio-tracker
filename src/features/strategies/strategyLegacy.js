import { STRATEGY_LEDGER_VERSION, StrategyDecimal as D, decimal, normalizeOpening, fail } from './strategyModel.js';

// Explicit checkpoint, never a reconstruction of unknown historical transactions.
export function createStrategyOpeningFromLegacy(strategy, { asOfDate }) {
  if (!strategy || typeof strategy !== 'object' || Array.isArray(strategy)) {
    fail('INVALID_OBJECT', 'La estrategia existente debe ser un objeto.');
  }
  const assets = strategy.boughtAssetsFromDb ?? strategy.boughtAssets ?? [];
  if (!Array.isArray(assets)) fail('INVALID_POSITIONS', 'La posición existente debe ser un arreglo.');
  const cash = { ARS: new D(0), USD: new D(0) };
  const positions = [];
  for (const asset of assets) {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
      fail('INVALID_OBJECT', 'La posición existente contiene un activo inválido.');
    }
    const ticker = typeof asset.ticker === 'string' ? asset.ticker.trim().toUpperCase() : '';
    const quantity = decimal(asset.quantity, 'quantity');
    if (quantity.isZero()) continue;
    if (['ARS', 'PESOS', 'USD'].includes(ticker)) {
      const currency = ticker === 'USD' ? 'USD' : 'ARS';
      cash[currency] = cash[currency].plus(quantity);
      continue;
    }
    const price = decimal(asset.priceAtTrade, 'priceAtTrade');
    const divisor = decimal(asset.priceDivisor ?? '1', 'priceDivisor', { positive: true });
    positions.push({
      ticker, currency: 'ARS', quantity: quantity.toFixed(),
      costBasis: quantity.times(price).div(divisor).toFixed(), priceDivisor: divisor.toFixed(),
    });
  }
  return normalizeOpening({
    version: STRATEGY_LEDGER_VERSION, asOfDate, positions,
    cash: Object.fromEntries(Object.entries(cash).map(([code, amount]) => [code, amount.toFixed()])),
  });
}
