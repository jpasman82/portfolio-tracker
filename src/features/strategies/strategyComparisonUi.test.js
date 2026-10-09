import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import StrategyLedgerCard from './StrategyLedgerCard.jsx';
import { createInitialPortfolio } from './strategyInitialPortfolio.js';

function fixture(totalARS = '360') {
  const strategy = {
    id: 'example', eventName: 'Estrategia de ejemplo', tradeDate: '2026-06-01', initialUsdRate: '2',
    currentUsdRateFromDb: '4', soldAssets: [{ ticker: 'USD', quantity: '100', priceAtTrade: '2' }],
    boughtAssets: [{ ticker: 'AAA', quantity: '10', priceAtTrade: '20' }],
    currentPricesFromDb: {}, initialPortfolioPricesFromDb: { 'AAA:ARS': '40' },
    ledgerOpening: { positions: [], cash: { ARS: '200', USD: '0' } },
    ledgerCashFlows: [{ id: 'out', type: 'withdrawal', tradeDate: '2026-10-01', sequence: 1, currency: 'ARS', amount: '20', usdRateAtTrade: '2', benchmarkValueARSAtTrade: '200' }],
    ledgerBalances: { positions: [], cash: { ARS: totalARS, USD: '0' }, realizedResult: { ARS: '0', USD: '0' }, netContributions: { ARS: '-20', USD: '0' } },
  };
  strategy.initialPortfolio = createInitialPortfolio(strategy);
  return strategy;
}
const render = strategy => renderToStaticMarkup(createElement(StaticRouter, null, createElement(StrategyLedgerCard, { strategy })));

describe('strategy summary comparisons', () => {
  it('shows Alfa with withdrawals and the original portfolio as a separate comparison', () => {
    const markup = render(fixture());
    expect(markup).toContain('ALFA');
    expect(markup).toContain('+0.0 p.p.');
    expect(markup).toContain('Cartera inicial sin cambios');
    expect(markup).toContain('USD 100');
    expect(markup).toContain('La referencia recibe los mismos aportes y retiros.');
  });
  it('shows a negative Alfa and Delta without changing the frozen comparison', () => {
    const markup = render(fixture('320'));
    expect(markup).toContain('-10.0 p.p.');
    expect(markup).toContain('USD -10,00');
    expect(markup).toContain('Cartera inicial sin cambios');
    expect(markup).toContain('USD 100');
  });
  it('reports missing historical flow data explicitly', () => {
    const strategy = fixture();
    delete strategy.ledgerCashFlows[0].usdRateAtTrade;
    expect(render(strategy)).toContain('Falta el dólar de la fecha');
  });
});
