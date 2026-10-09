import { StrategyDecimal as D, decimal, fail, positionKey } from './strategyModel.js';
import { valueStrategyBalances } from './strategyEngine.js';
import { benchmarkPosition, benchmarkValuationDate } from './strategyBenchmark.js';
import { cashFlowMetrics } from './strategyCashFlows.js';
import { initialPortfolioMetrics } from './strategyInitialPortfolio.js';

// Strict localized parsing without conversion through binary floating point.
export function parseStrategyAmount(value, field = 'Importe') {
  const text = String(value ?? '').trim();
  const grouped = /^\d{1,3}(\.\d{3})+$/;
  let canonical;
  if (text.includes(',')) {
    const parts = text.split(',');
    if (parts.length !== 2 || !/^\d*$/.test(parts[1])
      || (!/^\d+$/.test(parts[0]) && !grouped.test(parts[0]))) {
      fail('INVALID_DECIMAL', `${field}: usar un número, por ejemplo 1.234,56.`);
    }
    canonical = `${parts[0].replace(/\./g, '')}.${parts[1] || '0'}`;
  } else if (grouped.test(text)) canonical = text.replace(/\./g, '');
  else canonical = text;
  return decimal(canonical, field).toFixed();
}

export function formatStrategyAmount(value, decimals = 2) {
  const [integer, fraction] = new D(value ?? 0).toFixed(decimals).split('.');
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${fraction == null ? '' : `,${fraction}`}`;
}

export function strategyQuote(position, prices) {
  const saved = prices?.[positionKey(position)] ?? (position.currency === 'ARS' ? prices?.[position.ticker] : null);
  if (saved != null) return { price: decimal(saved, 'Precio').toFixed(), estimated: false };
  return { price: new D(position.averageCost).times(position.priceDivisor).toFixed(), estimated: true };
}

export function strategyMetrics(strategy, { balances = strategy.ledgerBalances, prices = {}, usdRate, soldPrices = {}, initialPrices = {}, asOfDate = benchmarkValuationDate(strategy) } = {}) {
  const rate = decimal(usdRate ?? strategy.currentUsdRateFromDb ?? strategy.initialUsdRate ?? '1', 'Dólar', { positive: true });
  const initialRate = decimal(strategy.initialUsdRate ?? rate.toFixed(), 'Dólar inicial', { positive: true });
  const quotes = {};
  const estimatedTickers = [];
  balances.positions.forEach(position => {
    const quote = strategyQuote(position, prices);
    quotes[positionKey(position)] = quote.price;
    if (quote.estimated) estimatedTickers.push(position.ticker);
  });
  const valuation = valueStrategyBalances({ balances, prices: quotes });
  const totalARS = new D(valuation.ARS.equity).plus(new D(valuation.USD.equity).times(rate));
  const totalUSD = totalARS.div(rate);
  const activePositionCostARS = balances.positions.reduce((sum, position) => sum.plus(
    position.currency === 'USD' ? new D(position.costBasis).times(initialRate) : position.costBasis,
  ), new D(0));
  const activePositionCostUSD = balances.positions.reduce((sum, position) => sum.plus(
    position.currency === 'ARS' ? new D(position.costBasis).div(initialRate) : position.costBasis,
  ), new D(0));
  const activePositionValueARS = new D(valuation.ARS.marketValue).plus(new D(valuation.USD.marketValue).times(rate));
  const activePositionValueUSD = new D(valuation.ARS.marketValue).div(rate).plus(valuation.USD.marketValue);
  const activePositionResultARS = activePositionValueARS.minus(activePositionCostARS);
  const activePositionResultUSD = activePositionValueUSD.minus(activePositionCostUSD);
  const activePositionReturnPctARS = activePositionCostARS.isZero()
    ? null : activePositionResultARS.div(activePositionCostARS).times(100).toNumber();
  const activePositionReturnPctUSD = activePositionCostUSD.isZero()
    ? null : activePositionResultUSD.div(activePositionCostUSD).times(100).toNumber();
  let initialARS = new D(0);
  let benchmarkARS = new D(0);
  const benchmarkPositions = [];
  (strategy.soldAssets ?? []).forEach(asset => {
    const quantity = decimal(asset.quantity ?? 0, 'Cantidad inicial');
    const price = decimal(asset.priceAtTrade ?? 0, 'Precio inicial');
    initialARS = initialARS.plus(quantity.times(price));
    const reference = benchmarkPosition(strategy, asset, asOfDate);
    const ticker = reference.ticker;
    const currentPrice = ticker === 'USD' ? rate : ['ARS', 'PESOS'].includes(ticker) ? new D(1)
      : soldPrices[ticker] ?? soldPrices[asset.ticker] ?? reference.equivalentInitialPrice;
    const valueARS = new D(reference.quantity).times(currentPrice);
    benchmarkARS = benchmarkARS.plus(valueARS);
    benchmarkPositions.push({ ...reference, currentPrice: new D(currentPrice).toFixed(), valueARS: valueARS.toFixed() });
  });
  const benchmarkCashARS = decimal(strategy.benchmarkCash?.ARS ?? '0', 'Efectivo de referencia ARS');
  const benchmarkCashUSD = decimal(strategy.benchmarkCash?.USD ?? '0', 'Efectivo de referencia USD');
  benchmarkARS = benchmarkARS.plus(benchmarkCashARS).plus(benchmarkCashUSD.times(rate));
  if (strategy.initialCapitalARS != null) initialARS = decimal(strategy.initialCapitalARS, 'Capital inicial');
  if (initialARS.isZero()) {
    initialARS = strategy.ledgerOpening.positions.reduce((sum, position) => sum.plus(position.currency === 'USD' ? new D(position.costBasis).times(initialRate) : position.costBasis), new D(0))
      .plus(strategy.ledgerOpening.cash.ARS).plus(new D(strategy.ledgerOpening.cash.USD).times(initialRate));
  }
  const initialUSD = initialARS.div(initialRate);
  const flows = cashFlowMetrics(strategy, balances, asOfDate);
  const { hasFlows } = flows;
  const adjustedARS = totalARS.minus(flows.netARS);
  const adjustedUSD = totalUSD.minus(flows.netUSD);
  const pARS = flows.flowIssue ? null : initialARS.isZero() ? 0 : adjustedARS.div(initialARS).minus(1).times(100).toNumber();
  const pUSD = flows.flowIssue ? null : initialUSD.isZero() ? 0 : adjustedUSD.div(initialUSD).minus(1).times(100).toNumber();
  const fullBenchmarkARS = benchmarkARS;
  benchmarkARS = flows.benchmarkIssue ? null : fullBenchmarkARS.times(flows.factor);
  const benchmarkUSD = benchmarkARS?.div(rate);
  const deltaUSD = benchmarkUSD == null || fullBenchmarkARS.isZero() ? null : totalUSD.minus(benchmarkUSD);
  const pBenchmarkUSD = benchmarkUSD == null || initialUSD.isZero() ? null : benchmarkUSD.minus(flows.netUSD).div(initialUSD).minus(1).times(100).toNumber();
  const pALFA = deltaUSD == null || initialUSD.isZero() ? null : deltaUSD.div(initialUSD).times(100).toNumber();
  const initialPortfolio = initialPortfolioMetrics(strategy, { prices: initialPrices, usdRate: rate.toFixed(), asOfDate });
  return {
    valuation, quotes, estimatedTickers, totalARS: totalARS.toFixed(), totalUSD: totalUSD.toFixed(),
    activePositionCostARS: activePositionCostARS.toFixed(), activePositionCostUSD: activePositionCostUSD.toFixed(),
    activePositionValueARS: activePositionValueARS.toFixed(), activePositionValueUSD: activePositionValueUSD.toFixed(),
    activePositionResultARS: activePositionResultARS.toFixed(), activePositionResultUSD: activePositionResultUSD.toFixed(),
    activePositionReturnPctARS, activePositionReturnPctUSD,
    initialARS: initialARS.toFixed(), initialUSD: initialUSD.toFixed(),
    resultARS: flows.flowIssue ? null : adjustedARS.minus(initialARS).toFixed(), resultUSD: flows.flowIssue ? null : adjustedUSD.minus(initialUSD).toFixed(),
    benchmarkARS: benchmarkARS?.toFixed() ?? null, benchmarkUSD: benchmarkUSD?.toFixed() ?? null,
    fullBenchmarkARS: fullBenchmarkARS.toFixed(), fullBenchmarkUSD: fullBenchmarkARS.div(rate).toFixed(),
    deltaARS: deltaUSD == null ? null : totalARS.minus(benchmarkARS).toFixed(),
    deltaUSD: deltaUSD?.toFixed() ?? null, flows, initialPortfolio,
    pARS, pUSD, pALFA, pBenchmarkUSD, hasFlows, benchmarkPositions, valuationDate: asOfDate,
  };
}
