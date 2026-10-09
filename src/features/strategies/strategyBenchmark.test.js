import { describe, expect, it } from 'vitest';
import { benchmarkPosition, benchmarkValuationDate } from './strategyBenchmark.js';
import { strategyMetrics } from './strategyUi.js';

const adjustment = {
  id: 'ETHA-reverse-split-2026-10-06', ticker: 'ETHA', effectiveDate: '2026-10-06',
  quantityNumerator: '1', quantityDenominator: '3',
};
function fixture() {
  return {
    tradeDate: '2026-10-01', initialUsdRate: '1', initialCapitalARS: '30',
    soldAssets: [{ ticker: 'ETHA', quantity: '15', priceAtTrade: '2' }],
    benchmarkAdjustments: [adjustment], benchmarkCash: { ARS: '0', USD: '0' },
    ledgerOpening: { positions: [], cash: { ARS: '30', USD: '0' } },
    ledgerBalances: {
      positions: [], cash: { ARS: '30', USD: '0' },
      realizedResult: { ARS: '0', USD: '0' }, netContributions: { ARS: '0', USD: '0' },
    },
  };
}

describe('dated benchmark corporate actions', () => {
  it('retains original units before the effective date', () => {
    const strategy = fixture();
    const metrics = strategyMetrics(strategy, { usdRate: '1', soldPrices: { ETHA: '2' }, asOfDate: '2026-10-05' });
    expect(metrics.benchmarkPositions[0].quantity).toBe('15');
    expect(metrics.benchmarkUSD).toBe('30');
    expect(metrics.pALFA).toBe(0);
  });

  it('uses equivalent units from the effective date without changing initial capital', () => {
    const strategy = fixture();
    const before = JSON.stringify(strategy);
    const metrics = strategyMetrics(strategy, { usdRate: '1', soldPrices: { ETHA: '6' }, asOfDate: '2026-10-06' });
    expect(metrics.benchmarkPositions[0].quantity).toBe('5');
    expect(metrics.benchmarkPositions[0].equivalentInitialPrice).toBe('6');
    expect(metrics.initialARS).toBe('30');
    expect(metrics.initialUSD).toBe('30');
    expect(metrics.benchmarkUSD).toBe('30');
    expect(metrics.totalUSD).toBe('30');
    expect(metrics.deltaUSD).toBe('0');
    expect(metrics.pALFA).toBe(0);
    expect(JSON.stringify(strategy)).toBe(before);
    expect(strategyMetrics(strategy, { usdRate: '1', soldPrices: { ETHA: '6' }, asOfDate: '2026-10-09' }).benchmarkUSD).toBe('30');
  });

  it('preserves the historical initial value when there is no capital override', () => {
    const strategy = fixture();
    delete strategy.initialCapitalARS;
    expect(strategyMetrics(strategy, { asOfDate: '2026-10-09' }).initialARS).toBe('30');
  });

  it('uses an equivalent initial quote when the current quote is unavailable', () => {
    const metrics = strategyMetrics(fixture(), { usdRate: '1', asOfDate: '2026-10-09' });
    expect(metrics.benchmarkPositions[0].currentPrice).toBe('6');
    expect(metrics.benchmarkUSD).toBe('30');
    expect(metrics.pALFA).toBe(0);
  });

  it('only adjusts the matching ticker and leaves the USD reference nominal fixed', () => {
    const strategy = fixture();
    strategy.soldAssets.push({ ticker: 'OTHER', quantity: '2', priceAtTrade: '4' });
    strategy.benchmarkCash.USD = '10';
    const metrics = strategyMetrics(strategy, { usdRate: '2', soldPrices: { ETHA: '6', OTHER: '4' }, asOfDate: '2026-10-09' });
    expect(metrics.benchmarkPositions[1].quantity).toBe('2');
    expect(metrics.benchmarkARS).toBe('58');
    expect(strategy.benchmarkCash.USD).toBe('10');
  });

  it('does not apply a split that predates the strategy or occurs on its start date', () => {
    const strategy = fixture();
    strategy.tradeDate = '2026-10-06';
    strategy.soldAssets[0] = { ticker: 'ETHA', quantity: '5', priceAtTrade: '6' };
    expect(benchmarkPosition(strategy, strategy.soldAssets[0], '2026-10-09').quantity).toBe('5');
  });

  it('composes multiple adjustments without rounding fractional units', () => {
    const strategy = fixture();
    strategy.soldAssets[0].quantity = '1';
    strategy.benchmarkAdjustments.push({ ...adjustment, id: 'second', effectiveDate: '2026-10-07', quantityNumerator: '3', quantityDenominator: '1' });
    expect(benchmarkPosition(strategy, strategy.soldAssets[0], '2026-10-09').quantity).toBe('1');
  });

  it('rejects duplicate action identifiers and invalid ratios', () => {
    const strategy = fixture();
    strategy.benchmarkAdjustments.push(adjustment);
    expect(() => benchmarkPosition(strategy, strategy.soldAssets[0], '2026-10-09')).toThrow(/repetido/);
    strategy.benchmarkAdjustments = [{ ...adjustment, quantityDenominator: '0' }];
    expect(() => benchmarkPosition(strategy, strategy.soldAssets[0], '2026-10-09')).toThrow(/inválido/);
  });

  it('uses Buenos Aires dates and freezes the valuation date when closed', () => {
    expect(benchmarkValuationDate(fixture(), new Date('2026-10-06T01:30:00Z'))).toBe('2026-10-05');
    const strategy = { ...fixture(), isClosed: true, valuationDate: '2026-10-05' };
    const metrics = strategyMetrics(strategy, { usdRate: '1', soldPrices: { ETHA: '2' } });
    expect(metrics.benchmarkPositions[0].quantity).toBe('15');
  });

  it('keeps existing strategies without adjustments unchanged', () => {
    const strategy = fixture();
    delete strategy.benchmarkAdjustments;
    expect(strategyMetrics(strategy, { usdRate: '1', soldPrices: { ETHA: '2' }, asOfDate: '2026-10-09' }).benchmarkUSD).toBe('30');
  });
});
