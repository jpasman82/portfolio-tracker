import { StrategyDecimal as D, decimal } from './strategyModel.js';

export function strategyCashFlows(records) {
  return records.filter(record => record.status === 'active' && ['contribution', 'withdrawal'].includes(record.type))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.sequence - b.sequence)
    .map(record => ({
      id: record.id, type: record.type, tradeDate: record.tradeDate, sequence: record.sequence,
      currency: record.currency, amount: record.amount,
      ...(record.usdRateAtTrade == null ? {} : { usdRateAtTrade: record.usdRateAtTrade }),
      ...(record.benchmarkValueARSAtTrade == null ? {} : { benchmarkValueARSAtTrade: record.benchmarkValueARSAtTrade }),
    }));
}

// The full original benchmark value is used here, before any cash-flow scaling.
export function cashBenchmarkValueARS(strategy, usdRate) {
  const rate = decimal(usdRate, 'Dólar de la fecha', { positive: true });
  let total = decimal(strategy.benchmarkCash?.ARS ?? '0', 'Referencia ARS')
    .plus(decimal(strategy.benchmarkCash?.USD ?? '0', 'Referencia USD').times(rate));
  for (const asset of strategy.soldAssets ?? []) {
    const quantity = decimal(asset.quantity ?? '0', 'Cantidad');
    if (quantity.isZero()) continue;
    const ticker = asset.ticker?.trim().toUpperCase();
    if (ticker === 'USD') total = total.plus(quantity.times(rate));
    else if (['ARS', 'PESOS'].includes(ticker)) total = total.plus(quantity);
    else return null;
  }
  return total.toFixed();
}

export function cashFlowMetrics(strategy, balances, asOfDate) {
  const flows = (strategy.ledgerCashFlows ?? []).filter(flow => flow.tradeDate <= asOfDate);
  const native = { ARS: new D(0), USD: new D(0) };
  let netARS = new D(0);
  let netUSD = new D(0);
  let factor = new D(1);
  let flowIssue = '';
  let benchmarkIssue = '';
  for (const flow of flows) {
    const amount = decimal(flow.amount, 'Movimiento de capital', { positive: true })
      .times(flow.type === 'contribution' ? 1 : -1);
    native[flow.currency] = native[flow.currency].plus(amount);
    if (flow.usdRateAtTrade == null) {
      flowIssue = 'Falta el dólar de la fecha en un aporte o retiro.';
      continue;
    }
    const rate = decimal(flow.usdRateAtTrade, 'Dólar del movimiento', { positive: true });
    const ars = flow.currency === 'ARS' ? amount : amount.times(rate);
    netARS = netARS.plus(ars);
    netUSD = netUSD.plus(ars.div(rate));
    const benchmarkValue = flow.benchmarkValueARSAtTrade ?? cashBenchmarkValueARS(strategy, rate.toFixed());
    if (benchmarkValue == null || new D(benchmarkValue).isZero()) {
      benchmarkIssue = 'Falta la valuación de la referencia en la fecha de un aporte o retiro.';
      continue;
    }
    factor = factor.plus(ars.div(decimal(benchmarkValue, 'Referencia de la fecha', { positive: true })));
    if (factor.isNegative()) benchmarkIssue = 'El retiro supera el capital disponible en la referencia.';
  }
  if (['ARS', 'USD'].some(currency => !native[currency].eq(balances.netContributions[currency]))) {
    flowIssue = 'Falta información de aportes o retiros para calcular el rendimiento.';
  }
  return {
    hasFlows: flows.length > 0 || ['ARS', 'USD'].some(currency => !new D(balances.netContributions[currency]).isZero()),
    netARS: netARS.toFixed(), netUSD: netUSD.toFixed(), factor: factor.toFixed(),
    flowIssue, benchmarkIssue: flowIssue || benchmarkIssue,
  };
}
