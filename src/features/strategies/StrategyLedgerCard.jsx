import { Link } from 'react-router-dom';
import { strategyMetrics, formatStrategyAmount } from './strategyUi';

export default function StrategyLedgerCard({ strategy }) {
  let metrics;
  let error = '';
  try {
    metrics = strategyMetrics(strategy, {
      prices: strategy.currentPricesFromByma ?? strategy.currentPricesFromDb,
      soldPrices: strategy.soldCurrentPricesFromByma ?? strategy.soldCurrentPricesFromDb,
      initialPrices: strategy.initialPortfolioPricesFromByma ?? strategy.initialPortfolioPricesFromDb,
      usdRate: strategy.currentUsdRateFromByma ?? strategy.currentUsdRateFromDb ?? strategy.initialUsdRate,
    });
  } catch (cause) { error = cause.message; }
  return (
    <Link to={`/evento/${strategy.id}`} className="no-underline text-inherit">
      <article className={`bg-[#122329] border border-teal-400/15 rounded-2xl p-5 hover:border-teal-400/35 ${strategy.isClosed ? 'opacity-60' : ''}`}>
        <h3 className="text-lg font-bold text-[#F0FAFA]">{strategy.eventName}</h3>
        <p className="text-xs text-[#A8C8C8] mt-2">{strategy.tradeDate} · {strategy.isClosed ? 'Cerrada' : 'Activa'} · {strategy.ledgerActiveCount ?? 0} operaciones</p>
        {error ? <p role="alert" className="text-red-300 text-sm mt-3">No se pudo calcular el saldo: {error}</p> : (
          <>
            <div className="grid grid-cols-2 gap-3 mt-4 bg-[#0C1518] rounded-xl p-3 text-sm">
              <div><p className="text-teal-300">Valor actual · posiciones activas</p><strong className="block text-lg text-[#F0FAFA]">USD {formatStrategyAmount(metrics.activePositionValueUSD, 0)}</strong><p className="text-[#A8C8C8]">$ {formatStrategyAmount(metrics.activePositionValueARS, 0)}</p></div>
              <div className="text-right"><p className="text-[#A8C8C8]">Base inicial activa</p><strong className="block text-lg text-[#F0FAFA]">USD {formatStrategyAmount(metrics.activePositionCostUSD, 0)}</strong><p className="text-[#A8C8C8]">$ {formatStrategyAmount(metrics.activePositionCostARS, 0)}</p></div>
            </div>
            <p className={metrics.activePositionResultUSD < 0 ? 'text-sm text-red-300 mt-3' : 'text-sm text-teal-300 mt-3'}>Resultado abierto: USD {formatStrategyAmount(metrics.activePositionResultUSD)} · {metrics.activePositionReturnPct == null ? '—' : (metrics.activePositionReturnPct >= 0 ? '+' : '') + metrics.activePositionReturnPct.toFixed(1) + '%'}</p>
            <div className="grid grid-cols-2 gap-3 mt-3 bg-[#0C1518] rounded-xl p-3 text-sm">
              <div><p className="text-teal-300">Patrimonio total</p><strong className="block text-lg text-[#F0FAFA]">USD {formatStrategyAmount(metrics.totalUSD, 0)}</strong><p className="text-[#A8C8C8]">$ {formatStrategyAmount(metrics.totalARS, 0)}</p></div>
              <div className="text-right"><p className="text-[#A8C8C8]">Capital inicial original</p><strong className="block text-lg text-[#F0FAFA]">USD {formatStrategyAmount(metrics.initialUSD, 0)}</strong><p className="text-[#A8C8C8]">$ {formatStrategyAmount(metrics.initialARS, 0)}</p></div>
            </div>
            <p className="text-xs text-[#A8C8C8] mt-3">Efectivo: $ {formatStrategyAmount(strategy.ledgerBalances.cash.ARS)} · USD {formatStrategyAmount(strategy.ledgerBalances.cash.USD)}</p>
            <div className="grid grid-cols-3 gap-2 mt-4 text-center text-xs">{[['TOTAL USD', metrics.pUSD], ['TOTAL ARS', metrics.pARS], ['ALFA', metrics.pALFA]].map(([label, value]) => <div key={label} className="bg-[#0C1518] rounded-xl py-3"><p className="text-[#A8C8C8]">{label}</p><strong className={`block text-base mt-1 ${value == null ? 'text-[#A8C8C8]' : value < 0 ? 'text-red-300' : 'text-teal-300'}`}>{value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}${label === 'ALFA' ? ' p.p.' : '%'}`}</strong></div>)}</div>
            <p className={metrics.deltaUSD != null && Number(metrics.deltaUSD) < 0 ? 'text-sm text-red-300 mt-3' : 'text-sm text-teal-300 mt-3'}>Delta: {metrics.deltaUSD == null ? "—" : `USD ${formatStrategyAmount(metrics.deltaUSD)}`}</p>
            {metrics.estimatedTickers.length > 0 && <p className="text-xs text-amber-300 mt-3">Sin cotización: {metrics.estimatedTickers.join(', ')}. Valuados al costo.</p>}
            {metrics.hasFlows && <p className="text-xs text-[#A8C8C8] mt-3">Rendimiento simple con movimientos al dólar de su fecha. La referencia recibe los mismos aportes y retiros.</p>}
            {metrics.flows.benchmarkIssue && <p className="text-xs text-amber-300 mt-3">{metrics.flows.benchmarkIssue}</p>}
            {metrics.initialPortfolio && <div className="mt-3 pt-3 border-t border-teal-400/15 text-sm">
              <p className="text-[#A8C8C8]">Cartera inicial sin cambios</p>
              <p className="text-teal-300">USD {formatStrategyAmount(metrics.initialPortfolio.totalUSD, 0)} · {metrics.initialPortfolio.pUSD == null ? '—' : `${metrics.initialPortfolio.pUSD >= 0 ? '+' : ''}${metrics.initialPortfolio.pUSD.toFixed(1)}%`}</p>
              {metrics.initialPortfolio.estimatedTickers.length > 0 && <p className="text-xs text-amber-300">Sin cotización: {metrics.initialPortfolio.estimatedTickers.join(', ')}.</p>}
            </div>}
          </>
        )}
      </article>
    </Link>
  );
}
