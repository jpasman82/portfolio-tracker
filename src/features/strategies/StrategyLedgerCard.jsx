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
  const resultUSD = Number(metrics?.activePositionResultUSD ?? 0);
  const resultARS = Number(metrics?.activePositionResultARS ?? 0);
  const directionSymbol = value => value > 0 ? '↑' : value < 0 ? '↓' : '→';
  const directionTone = value => value > 0 ? 'text-green-300' : value < 0 ? 'text-red-300' : 'text-[#A8C8C8]';
  const signedAmount = value => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatStrategyAmount(Math.abs(value))}`;
  return (
    <Link to={`/evento/${strategy.id}`} className="no-underline text-inherit">
      <article className={`bg-[#122329] border border-teal-400/15 rounded-2xl p-5 hover:border-teal-400/35 ${strategy.isClosed ? 'opacity-60' : ''}`}>
        <h3 className="text-lg font-bold text-[#F0FAFA]">{strategy.eventName}</h3>
        <p className="text-xs text-[#A8C8C8] mt-2">{strategy.tradeDate} · {strategy.isClosed ? 'Cerrada' : 'Activa'} · {strategy.ledgerActiveCount ?? 0} operaciones</p>
        {error ? <p role="alert" className="text-red-300 text-sm mt-3">No se pudo calcular el saldo: {error}</p> : (
          <>
            <div className="grid grid-cols-2 gap-3 mt-4 bg-[#0C1518] rounded-xl p-3 text-sm">
              <div><p className="text-teal-300">Valor actual · posiciones activas</p><strong className="block text-lg text-[#F0FAFA]">USD {formatStrategyAmount(metrics.activePositionValueUSD, 0)}</strong><p className="text-[#A8C8C8]">$ {formatStrategyAmount(metrics.activePositionValueARS, 0)}</p></div>
              <div className="text-right"><p className="text-[#A8C8C8]">Valor inicial ajustado por ventas</p><strong className="block text-lg text-[#F0FAFA]">USD {formatStrategyAmount(metrics.activePositionCostUSD, 0)}</strong><p className="text-[#A8C8C8]">$ {formatStrategyAmount(metrics.activePositionCostARS, 0)}</p></div>
            </div>
            <div className={`mt-3 rounded-xl border border-teal-400/10 bg-[#0C1518] px-3 py-2 ${directionTone(resultUSD)}`}>
              <p className="font-mono text-[10px] tracking-[0.18em] uppercase opacity-75">Resultado en posiciones activas</p>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-1">
                <strong className="text-lg font-black">{directionSymbol(resultUSD)} USD {signedAmount(resultUSD)}</strong>
                <strong className={`text-sm font-bold ${directionTone(resultARS)}`}>{directionSymbol(resultARS)} $ {signedAmount(resultARS)}</strong>
                <span className="font-mono text-sm font-bold">{metrics.activePositionReturnPctUSD == null ? '—' : `${directionSymbol(metrics.activePositionReturnPctUSD)} ${metrics.activePositionReturnPctUSD >= 0 ? '+' : ''}${metrics.activePositionReturnPctUSD.toFixed(1)}% USD`}</span>
              </div>
            </div>
            <p className="text-xs text-[#A8C8C8] mt-3">Efectivo: $ {formatStrategyAmount(strategy.ledgerBalances.cash.ARS)} · USD {formatStrategyAmount(strategy.ledgerBalances.cash.USD)}</p>
            <div className="grid grid-cols-3 gap-2 mt-4 text-center text-xs">
              {[["TOTAL USD", metrics.pUSD], ["TOTAL ARS", metrics.pARS], ["ALFA", metrics.pALFA]].map(([label, value]) => (
                <div key={label} className="bg-[#0C1518] rounded-xl py-3">
                  <p className="text-[#A8C8C8]">{label}</p>
                  <strong className={`block text-base font-black mt-1 ${value == null ? 'text-[#A8C8C8]' : directionTone(value)}`}>
                    {value == null ? '—' : `${directionSymbol(value)} ${value >= 0 ? '+' : ''}${value.toFixed(1)}${label === 'ALFA' ? ' p.p.' : '%'}`}
                  </strong>
                </div>
              ))}
            </div>
            <p className={`text-sm font-bold mt-3 ${metrics.deltaUSD == null ? 'text-[#A8C8C8]' : directionTone(Number(metrics.deltaUSD))}`}>
              Delta vs. referencia: {metrics.deltaUSD == null ? '—' : `${directionSymbol(Number(metrics.deltaUSD))} USD ${signedAmount(Number(metrics.deltaUSD))}`}
            </p>
            {metrics.estimatedTickers.length > 0 && <p className="text-xs text-amber-300 mt-3">Sin cotización: {metrics.estimatedTickers.join(', ')}. Valuados al costo.</p>}
            {metrics.hasFlows && <p className="text-xs text-[#A8C8C8] mt-3">Rendimiento simple con movimientos al dólar de su fecha. La referencia recibe los mismos aportes y retiros.</p>}
            {metrics.flows.benchmarkIssue && <p className="text-xs text-amber-300 mt-3">{metrics.flows.benchmarkIssue}</p>}
            {metrics.initialPortfolio && <div className="mt-3 pt-3 border-t border-teal-400/15 text-sm">
              <p className="text-[#A8C8C8]">Cartera inicial sin cambios</p>
              <p className={`font-bold ${metrics.initialPortfolio.pUSD == null ? 'text-[#A8C8C8]' : directionTone(metrics.initialPortfolio.pUSD)}`}>
                USD {formatStrategyAmount(metrics.initialPortfolio.totalUSD, 0)} · {metrics.initialPortfolio.pUSD == null ? '—' : `${directionSymbol(metrics.initialPortfolio.pUSD)} ${metrics.initialPortfolio.pUSD >= 0 ? '+' : ''}${metrics.initialPortfolio.pUSD.toFixed(1)}%`}
              </p>
              {metrics.initialPortfolio.estimatedTickers.length > 0 && <p className="text-xs text-amber-300">Sin cotización: {metrics.initialPortfolio.estimatedTickers.join(', ')}.</p>}
            </div>}
          </>
        )}
      </article>
    </Link>
  );
}
