import { StrategyDecimal as D, dateOnly, decimal, fail, positionKey } from './strategyModel.js';
import { benchmarkPosition, benchmarkValuationDate } from './strategyBenchmark.js';

export function createInitialPortfolio(strategy, adjustments = []) {
  const assets = strategy.boughtAssets;
  if (!Array.isArray(assets) || assets.length === 0) return null;
  const cash = { ARS: new D(0), USD: new D(0) };
  const positions = new Map();
  for (const asset of assets) {
    const quantity = decimal(asset.quantity ?? '0', 'Cantidad original');
    if (quantity.isZero()) continue;
    const ticker = asset.ticker?.trim().toUpperCase();
    if (['ARS', 'PESOS', 'USD'].includes(ticker)) {
      const currency = ticker === 'USD' ? 'USD' : 'ARS';
      cash[currency] = cash[currency].plus(quantity);
      continue;
    }
    if (!ticker) fail('INVALID_TICKER', 'Ticker original inválido.');
    const currency = asset.currency ?? 'ARS';
    if (!['ARS', 'USD'].includes(currency)) fail('INVALID_CURRENCY', 'Moneda original inválida.');
    const priceDivisor = decimal(asset.priceDivisor ?? '1', 'Divisor', { positive: true });
    const key = positionKey({ ticker, currency });
    const previous = positions.get(key);
    if (previous && previous.priceDivisor !== priceDivisor.toFixed()) fail('INCONSISTENT_PRICE_DIVISOR', 'Cotización original incompatible.');
    const cost = quantity.times(decimal(asset.priceAtTrade, 'Precio original')).div(priceDivisor);
    positions.set(key, {
      ticker, currency, priceDivisor: priceDivisor.toFixed(),
      quantity: quantity.plus(previous?.quantity ?? '0').toFixed(),
      cost: cost.plus(previous?.cost ?? '0').toFixed(),
    });
  }
  return {
    version: 'strategy-initial-portfolio-v1', asOfDate: dateOnly(strategy.tradeDate, 'Inicio'),
    initialUsdRate: decimal(strategy.initialUsdRate, 'Dólar inicial', { positive: true }).toFixed(),
    source: 'boughtAssets', adjustments,
    cash: Object.fromEntries(Object.entries(cash).map(([currency, amount]) => [currency, amount.toFixed()])),
    positions: [...positions.values()].map(({ cost, ...position }) => ({
      ...position, priceAtTrade: new D(cost).times(position.priceDivisor).div(position.quantity).toFixed(),
    })),
  };
}

export function initialPortfolioPosition(strategy, position, asOfDate = benchmarkValuationDate(strategy)) {
  return benchmarkPosition({
    tradeDate: strategy.initialPortfolio.asOfDate,
    benchmarkAdjustments: strategy.initialPortfolio.adjustments ?? [],
  }, position, asOfDate);
}

export function initialPortfolioMetrics(strategy, { prices = {}, usdRate, asOfDate = benchmarkValuationDate(strategy) } = {}) {
  const portfolio = strategy.initialPortfolio;
  if (!portfolio) return null;
  const rate = decimal(usdRate ?? strategy.currentUsdRateFromDb ?? strategy.initialUsdRate, 'Dólar', { positive: true });
  const initialRate = decimal(portfolio.initialUsdRate, 'Dólar inicial', { positive: true });
  let initialARS = decimal(portfolio.cash.ARS, 'Pesos originales')
    .plus(decimal(portfolio.cash.USD, 'Dólares originales').times(initialRate));
  let totalARS = decimal(portfolio.cash.ARS, 'Pesos originales')
    .plus(decimal(portfolio.cash.USD, 'Dólares originales').times(rate));
  const estimatedTickers = [];
  const positions = portfolio.positions.map(position => {
    const reference = initialPortfolioPosition(strategy, position, asOfDate);
    const supplied = prices[positionKey(position)] ?? (position.currency === 'ARS' ? prices[position.ticker] : null);
    if (supplied == null) estimatedTickers.push(position.ticker);
    const quote = decimal(supplied ?? reference.equivalentInitialPrice, 'Cotización original');
    const value = new D(reference.quantity).times(quote).div(position.priceDivisor);
    const originalValue = new D(position.quantity).times(position.priceAtTrade).div(position.priceDivisor);
    initialARS = initialARS.plus(position.currency === 'USD' ? originalValue.times(initialRate) : originalValue);
    const valueARS = position.currency === 'USD' ? value.times(rate) : value;
    totalARS = totalARS.plus(valueARS);
    return { ...position, ...reference, currentPrice: quote.toFixed(), valueARS: valueARS.toFixed(), valueUSD: valueARS.div(rate).toFixed() };
  });
  const initialUSD = initialARS.div(initialRate);
  const totalUSD = totalARS.div(rate);
  return {
    asOfDate, initialARS: initialARS.toFixed(), initialUSD: initialUSD.toFixed(),
    totalARS: totalARS.toFixed(), totalUSD: totalUSD.toFixed(),
    pARS: initialARS.isZero() ? null : totalARS.div(initialARS).minus(1).times(100).toNumber(),
    pUSD: initialUSD.isZero() ? null : totalUSD.div(initialUSD).minus(1).times(100).toNumber(),
    positions, cash: portfolio.cash, estimatedTickers,
  };
}
