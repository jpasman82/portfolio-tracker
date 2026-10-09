import { describe, expect, it } from 'vitest';
import { strategyMetrics } from './strategyUi.js';
import { cashBenchmarkValueARS, strategyCashFlows } from './strategyCashFlows.js';
import { createInitialPortfolio, initialPortfolioMetrics } from './strategyInitialPortfolio.js';
import { normalizeOperation } from './strategyModel.js';

function fixture(flows = [], netARS = '0', totalARS = '400') {
  return {
    tradeDate: '2026-06-01', initialUsdRate: '2',
    soldAssets: [{ ticker: 'USD', quantity: '100', priceAtTrade: '2' }],
    boughtAssets: [{ ticker: 'AAA', quantity: '10', priceAtTrade: '20' }],
    ledgerOpening: { positions: [], cash: { ARS: '200', USD: '0' } },
    ledgerCashFlows: flows,
    ledgerBalances: {
      positions: [], cash: { ARS: totalARS, USD: '0' }, realizedResult: { ARS: '0', USD: '0' },
      netContributions: { ARS: netARS, USD: '0' },
    },
  };
}
const withdrawal = { id: 'out', type: 'withdrawal', tradeDate: '2026-10-01', sequence: 1, currency: 'ARS', amount: '20', usdRateAtTrade: '2', benchmarkValueARSAtTrade: '200' };
const calculate = strategy => strategyMetrics(strategy, { usdRate: '4', asOfDate: '2026-10-09' });

describe('historical capital flows and Alfa', () => {
  it('returns removed dollars at the historical rate, with the same withdrawal in the benchmark', () => {
    const strategy = fixture([withdrawal], '-20', '360');
    const metrics = calculate(strategy);
    expect(metrics.flows.netUSD).toBe('-10');
    expect(metrics.flows.factor).toBe('0.9');
    expect(metrics.benchmarkUSD).toBe('90');
    expect(metrics.totalUSD).toBe('90');
    expect(metrics.pUSD).toBe(0);
    expect(metrics.deltaUSD).toBe('0');
    expect(metrics.pALFA).toBe(0);
  });
  it('neutralizes contributions on both sides of the comparison', () => {
    const metrics = calculate(fixture([{ ...withdrawal, type: 'contribution' }], '20', '440'));
    expect(metrics.benchmarkUSD).toBe('110');
    expect(metrics.pUSD).toBe(0);
    expect(metrics.pALFA).toBe(0);
  });
  it('retains timing effects when native contributions and withdrawals partly offset', () => {
    const flows = [{ ...withdrawal, type: 'contribution' }, { ...withdrawal, id: 'later', sequence: 2, amount: '40', usdRateAtTrade: '4', benchmarkValueARSAtTrade: '400' }];
    const metrics = calculate(fixture(flows, '-20'));
    expect(metrics.flows.netUSD).toBe('0');
    expect(metrics.flows.factor).toBe('1');
    expect(metrics.pUSD).toBe(0);
    expect(metrics.pALFA).toBe(0);
  });
  it('detects capital movements even if their native net amount is zero', () => {
    const flows = [{ ...withdrawal, type: 'contribution' }, { ...withdrawal, id: 'later', sequence: 2, usdRateAtTrade: '4', benchmarkValueARSAtTrade: '400' }];
    const metrics = calculate(fixture(flows));
    expect(metrics.hasFlows).toBe(true);
    expect(metrics.flows.netUSD).toBe('5');
    expect(metrics.benchmarkUSD).toBe('105');
    expect(metrics.pUSD).toBe(-5);
    expect(metrics.pALFA).toBe(-5);
  });
  it('scales a securities benchmark at its historical price without treating the withdrawal as a loss', () => {
    const strategy = fixture([withdrawal], '-20', '270');
    strategy.initialUsdRate = '1';
    strategy.soldAssets = [{ ticker: 'REF', quantity: '10', priceAtTrade: '10' }];
    const metrics = strategyMetrics(strategy, { usdRate: '1', soldPrices: { REF: '30' }, asOfDate: '2026-10-09' });
    expect(metrics.benchmarkARS).toBe('270');
    expect(metrics.deltaUSD).toBe('0');
    expect(metrics.pALFA).toBe(0);
  });
  it('calculates a cash-only benchmark at the historical rate without manual quotes', () => {
    const strategy = fixture([{ ...withdrawal, benchmarkValueARSAtTrade: undefined }], '-20', '360');
    expect(calculate(strategy).pALFA).toBe(0);
    expect(cashBenchmarkValueARS(strategy, '2')).toBe('200');
    strategy.soldAssets = [{ ticker: 'ARS', quantity: '200', priceAtTrade: '1' }];
    expect(cashBenchmarkValueARS(strategy, '4')).toBe('200');
  });
  it('does not invent a historical dollar for legacy flows', () => {
    const metrics = calculate(fixture([{ ...withdrawal, usdRateAtTrade: undefined }], '-20', '360'));
    expect(metrics.pUSD).toBeNull();
    expect(metrics.pALFA).toBeNull();
    expect(metrics.flows.flowIssue).toMatch(/dólar de la fecha/);
  });
  it('keeps the actual return available if only the historical securities benchmark quote is missing', () => {
    const strategy = fixture([{ ...withdrawal, benchmarkValueARSAtTrade: undefined }], '-20', '360');
    strategy.soldAssets = [{ ticker: 'REF', quantity: '10', priceAtTrade: '20' }];
    const metrics = calculate(strategy);
    expect(metrics.pUSD).toBe(0);
    expect(metrics.pALFA).toBeNull();
    expect(metrics.flows.benchmarkIssue).toMatch(/referencia/);
  });
  it('rejects an impossible benchmark withdrawal without hiding the actual valuation', () => {
    const metrics = calculate(fixture([{ ...withdrawal, benchmarkValueARSAtTrade: '10' }], '-20', '360'));
    expect(metrics.totalUSD).toBe('90');
    expect(metrics.pALFA).toBeNull();
    expect(metrics.flows.benchmarkIssue).toMatch(/supera/);
  });
  it('excludes cancelled operations from the cash-flow cache', () => {
    expect(strategyCashFlows([{ ...withdrawal, status: 'cancelled' }, { ...withdrawal, id: 'active', status: 'active' }])).toHaveLength(1);
  });
  it('normalizes and preserves cash-flow metadata across ledger replay', () => {
    const operation = normalizeOperation(withdrawal);
    expect(operation.usdRateAtTrade).toBe('2');
    expect(operation.benchmarkValueARSAtTrade).toBe('200');
    expect(() => normalizeOperation({ ...withdrawal, usdRateAtTrade: '0' })).toThrow();
  });
  it('does not alter flows, prices or benchmark inputs after repeated evaluations', () => {
    const strategy = fixture([withdrawal], '-20', '360');
    const before = JSON.stringify(strategy);
    calculate(strategy); calculate(strategy);
    expect(JSON.stringify(strategy)).toBe(before);
  });
});

describe('frozen initial strategy without subsequent changes', () => {
  it('captures the original purchases instead of the edited current portfolio', () => {
    const strategy = fixture();
    strategy.boughtAssetsFromDb = [{ ticker: 'OTHER', quantity: '999', priceAtTrade: '999' }];
    const snapshot = createInitialPortfolio(strategy);
    expect(snapshot.positions.map(p => p.ticker)).toEqual(['AAA']);
    expect(snapshot.asOfDate).toBe('2026-06-01');
  });
  it('ignores all subsequent operations and capital flows', () => {
    const strategy = fixture([withdrawal], '-20', '360');
    strategy.initialPortfolio = createInitialPortfolio(strategy);
    const options = { usdRate: '4', prices: { 'AAA:ARS': '40' }, asOfDate: '2026-10-09' };
    const before = initialPortfolioMetrics(strategy, options);
    strategy.ledgerBalances.cash.ARS = '0';
    strategy.ledgerCashFlows = [];
    const after = initialPortfolioMetrics(strategy, options);
    expect(before).toEqual(after);
    expect(after.initialUSD).toBe('100');
    expect(after.totalUSD).toBe('100');
    expect(after.pUSD).toBe(0);
  });
  it('keeps original peso and dollar cash in their currencies', () => {
    const strategy = fixture();
    strategy.boughtAssets = [{ ticker: 'PESOS', quantity: '200', priceAtTrade: '1' }, { ticker: 'USD', quantity: '20', priceAtTrade: '2' }];
    strategy.initialPortfolio = createInitialPortfolio(strategy);
    const metrics = initialPortfolioMetrics(strategy, { usdRate: '4', asOfDate: '2026-10-09' });
    expect(metrics.initialUSD).toBe('120');
    expect(metrics.totalUSD).toBe('70');
  });
  it('consolidates original duplicate lots while preserving cost', () => {
    const strategy = fixture();
    strategy.boughtAssets.push({ ticker: 'AAA', quantity: '10', priceAtTrade: '40' });
    const snapshot = createInitialPortfolio(strategy);
    expect(snapshot.positions).toHaveLength(1);
    expect(snapshot.positions[0].quantity).toBe('20');
    expect(snapshot.positions[0].priceAtTrade).toBe('30');
  });
  it('adjusts splits only in the hypothetical position and preserves original units and cost', () => {
    const strategy = fixture();
    strategy.boughtAssets = [{ ticker: 'ETHA', quantity: '15', priceAtTrade: '2' }];
    strategy.initialPortfolio = createInitialPortfolio(strategy, [{ id: 'split', ticker: 'ETHA', effectiveDate: '2026-10-06', quantityNumerator: '1', quantityDenominator: '3' }]);
    const before = JSON.stringify(strategy.initialPortfolio);
    const metrics = initialPortfolioMetrics(strategy, { usdRate: '2', prices: { 'ETHA:ARS': '6' }, asOfDate: '2026-10-09' });
    expect(metrics.positions[0].originalQuantity).toBe('15');
    expect(metrics.positions[0].quantity).toBe('5');
    expect(metrics.initialUSD).toBe('15');
    expect(metrics.totalUSD).toBe('15');
    expect(JSON.stringify(strategy.initialPortfolio)).toBe(before);
  });
  it('uses the quote divisor for bonds', () => {
    const strategy = fixture();
    strategy.boughtAssets = [{ ticker: 'BOND', quantity: '1000', priceAtTrade: '50', priceDivisor: '100' }];
    strategy.initialPortfolio = createInitialPortfolio(strategy);
    const metrics = initialPortfolioMetrics(strategy, { usdRate: '2', prices: { 'BOND:ARS': '50' }, asOfDate: '2026-10-09' });
    expect(metrics.initialARS).toBe('500');
    expect(metrics.totalARS).toBe('500');
  });
  it('marks missing quotes and uses equivalent initial cost instead of zero', () => {
    const strategy = fixture();
    strategy.initialPortfolio = createInitialPortfolio(strategy);
    const metrics = initialPortfolioMetrics(strategy, { usdRate: '2', asOfDate: '2026-10-09' });
    expect(metrics.estimatedTickers).toEqual(['AAA']);
    expect(metrics.totalUSD).toBe('100');
  });
});
