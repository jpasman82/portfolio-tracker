import { StrategyDecimal as D, dateOnly, decimal, fail } from './strategyModel.js';

// Historical receipts retain original units. Only the counterfactual position
// changes units when a dated corporate action becomes effective.
export function benchmarkValuationDate(strategy, now = new Date()) {
  if (strategy.isClosed) {
    const last = strategy.priceHistory?.at(-1);
    const savedDate = strategy.valuationDate ?? last?.valuationDate
      ?? (last?.timestampIso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(last.timestampIso)) : null);
    if (savedDate) return dateOnly(savedDate, 'Fecha de valuación');
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(now);
}

export function benchmarkPosition(strategy, asset, asOfDate = benchmarkValuationDate(strategy)) {
  dateOnly(asOfDate, 'Fecha de referencia');
  const startDate = dateOnly(strategy.tradeDate, 'Fecha inicial de referencia');
  const ticker = asset.ticker?.trim().toUpperCase();
  const originalQuantity = decimal(asset.quantity ?? '0', 'Cantidad inicial');
  const originalPrice = decimal(asset.priceAtTrade ?? '0', 'Precio inicial');
  const ids = new Set();
  const adjustments = (strategy.benchmarkAdjustments ?? []).filter(adjustment => {
    if (!adjustment.id || ids.has(adjustment.id)) fail('INVALID_BENCHMARK_ADJUSTMENT', 'Ajuste de referencia repetido o sin identificador.');
    ids.add(adjustment.id);
    const effectiveDate = dateOnly(adjustment.effectiveDate, 'Fecha del ajuste');
    return adjustment.ticker?.trim().toUpperCase() === ticker && effectiveDate > startDate && effectiveDate <= asOfDate;
  }).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.id.localeCompare(b.id));
  // Keep the ratio as numerator/denominator until the last division, so
  // inverse actions cancel exactly instead of accumulating rounded thirds.
  const ratio = adjustments.reduce((result, adjustment) => ({
    numerator: result.numerator.times(decimal(adjustment.quantityNumerator, 'Unidades nuevas', { positive: true })),
    denominator: result.denominator.times(decimal(adjustment.quantityDenominator, 'Unidades anteriores', { positive: true })),
  }), { numerator: new D(1), denominator: new D(1) });
  return {
    ticker, originalQuantity: originalQuantity.toFixed(), quantity: originalQuantity.times(ratio.numerator).div(ratio.denominator).toFixed(),
    equivalentInitialPrice: originalPrice.times(ratio.denominator).div(ratio.numerator).toFixed(), adjustments,
  };
}
