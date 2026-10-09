import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, auth } from '../../firebase/config';
import { fetchAllPrices, getMepRate } from '../../utils/priceService';
import { parseNum } from '../../utils/numberFormat';
import { createStrategyRepository } from './strategyRepository';
import { StrategyDecimal as D, positionKey } from './strategyModel';
import { formatStrategyAmount, parseStrategyAmount, strategyMetrics, strategyQuote } from './strategyUi';
import { benchmarkPosition } from './strategyBenchmark';
import { initialPortfolioPosition } from './strategyInitialPortfolio';
import StrategyOperationForm from './StrategyOperationForm';
import StrategyOperationHistory from './StrategyOperationHistory';

const repository = createStrategyRepository(db);
const CARD = 'bg-[#122329] border border-teal-400/15 rounded-2xl p-5 mb-4';
const INPUT = 'block w-full mt-1 bg-[#0C1518] border border-teal-400/20 rounded-xl p-3 text-[#F0FAFA] outline-none focus:border-teal-400/60 disabled:opacity-70';
const localized = value => new D(value).toFixed().replace('.', ',');
const money = (value, currency) => value == null ? '—' : `${currency === 'ARS' ? '$' : 'USD'} ${formatStrategyAmount(value)}`;
const percent = (value, unit = '%') => value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}${unit}`;

function quoteDrafts(ledger, livePrices) {
  const prices = {};
  const estimated = [];
  ledger.balances.positions.forEach(position => {
    const key = positionKey(position);
    const live = position.currency === 'ARS' && !ledger.strategy.isClosed ? livePrices[position.ticker] : null;
    const quote = strategyQuote(position, ledger.strategy.currentPricesFromDb);
    prices[key] = localized(live ?? quote.price);
    if (live == null && quote.estimated) estimated.push(key);
  });
  const soldPrices = {};
  (ledger.strategy.soldAssets ?? []).forEach(asset => {
    const ticker = asset.ticker?.trim().toUpperCase();
    if (!ticker) return;
    soldPrices[ticker] = localized((!ledger.strategy.isClosed ? livePrices[ticker] : null)
      ?? ledger.strategy.soldCurrentPricesFromDb?.[ticker] ?? ledger.strategy.soldCurrentPricesFromDb?.[asset.ticker] ?? benchmarkPosition(ledger.strategy, asset).equivalentInitialPrice);
  });
  const initialPrices = {};
  const initialEstimated = [];
  (ledger.strategy.initialPortfolio?.positions ?? []).forEach(position => {
    const key = positionKey(position);
    const live = position.currency === 'ARS' && !ledger.strategy.isClosed ? livePrices[position.ticker] : null;
    if (live == null && ledger.strategy.initialPortfolioPricesFromDb?.[key] == null) initialEstimated.push(key);
    initialPrices[key] = localized(live ?? ledger.strategy.initialPortfolioPricesFromDb?.[key]
      ?? initialPortfolioPosition(ledger.strategy, position).equivalentInitialPrice);
  });
  return { prices, soldPrices, initialPrices, initialEstimated, estimated };
}

export default function StrategyLedgerDetail({ strategyId }) {
  const navigate = useNavigate();
  const [ledger, setLedger] = useState(null);
  const [prices, setPrices] = useState({});
  const [soldPrices, setSoldPrices] = useState({});
  const [initialPrices, setInitialPrices] = useState({});
  const [estimated, setEstimated] = useState([]);
  const [initialEstimated, setInitialEstimated] = useState([]);
  const [usdRate, setUsdRate] = useState('');
  const [name, setName] = useState('');
  const [viewCurrency, setViewCurrency] = useState('USD');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const applyData = useCallback((next, priceMap) => {
    const drafts = quoteDrafts(next, priceMap);
    setLedger(next); setPrices(drafts.prices); setSoldPrices(drafts.soldPrices); setInitialPrices(drafts.initialPrices); setInitialEstimated(drafts.initialEstimated); setEstimated(drafts.estimated);
    setName(next.strategy.eventName ?? '');
    setUsdRate(localized((!next.strategy.isClosed ? getMepRate() : null) || next.strategy.currentUsdRateFromDb || next.strategy.initialUsdRate || 1));
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([repository.load(strategyId), fetchAllPrices().catch(() => ({}))])
      .then(([next, priceMap]) => { if (active) applyData(next, priceMap); })
      .catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [strategyId, applyData]);

  async function refresh() {
    setRefreshing(true);
    setError('');
    try {
      const [next, priceMap] = await Promise.all([repository.load(strategyId), fetchAllPrices().catch(() => ({}))]);
      applyData(next, priceMap);
    } catch (cause) { setError(cause.message); }
    finally { setRefreshing(false); }
  }

  async function addOperation(operation, expectedRevision) {
    if (!auth.currentUser) throw new Error('Iniciá sesión nuevamente para guardar.');
    setSaving(true);
    try {
      await repository.addOperation(strategyId, operation, expectedRevision, auth.currentUser.uid);
      setShowForm(false); setNotice('Operación guardada. Se actualizó el saldo de la estrategia.');
      await refresh();
    } finally { setSaving(false); }
  }
  async function cancelOperation(operationId, reason, expectedRevision) {
    if (!auth.currentUser) throw new Error('Iniciá sesión nuevamente para guardar.');
    setSaving(true);
    try {
      await repository.cancelOperation(strategyId, operationId, reason, expectedRevision, auth.currentUser.uid);
      setNotice('Operación anulada. El registro original sigue en el historial.');
      await refresh();
    } finally { setSaving(false); }
  }

  let metrics = null;
  let canonicalPrices;
  let canonicalSoldPrices;
  let canonicalInitialPrices;
  let canonicalRate;
  let calculationError = '';
  if (ledger) {
    try {
      canonicalRate = parseStrategyAmount(usdRate, 'Dólar');
      canonicalPrices = Object.fromEntries(Object.entries(prices).map(([key, value]) => [key, parseStrategyAmount(value, `Precio ${key}`)]));
      canonicalSoldPrices = Object.fromEntries(Object.entries(soldPrices).map(([key, value]) => [key, parseStrategyAmount(value, `Precio ${key}`)]));
      canonicalInitialPrices = Object.fromEntries(Object.entries(initialPrices).map(([key, value]) => [key, parseStrategyAmount(value, `Precio original ${key}`)]));
      metrics = strategyMetrics(ledger.strategy, { balances: ledger.balances, prices: canonicalPrices, soldPrices: canonicalSoldPrices, initialPrices: canonicalInitialPrices, usdRate: canonicalRate });
    } catch (cause) { calculationError = cause.message; }
  }
  async function saveSettings(isClosed) {
    setSaving(true); setError(''); setNotice('');
    try {
      await repository.saveSettings(strategyId, { eventName: name, prices: canonicalPrices, soldPrices: canonicalSoldPrices, initialPrices: canonicalInitialPrices, usdRate: canonicalRate, isClosed }, ledger.strategy.ledgerRevision);
      setNotice(isClosed ? 'Estrategia cerrada.' : 'Precios y estado guardados.');
      await refresh();
    } catch (cause) { setError(cause.message); }
    finally { setSaving(false); }
  }

  if (!ledger) return <div className="max-w-[500px] mx-auto p-6 text-[#A8C8C8]">{error ? <><p role="alert">{error}</p><button type="button" onClick={refresh} className="mt-3 text-teal-300">Volver a intentar</button></> : 'Cargando estrategia...'}</div>;
  const { strategy, balances, records } = ledger;
  const convert = (value, currency) => currency === viewCurrency ? value
    : viewCurrency === 'USD' ? new D(value).div(canonicalRate).toFixed() : new D(value).times(canonicalRate).toFixed();

  return (
    <main className="px-4 pt-6 max-w-[500px] mx-auto pb-32 font-[Space_Grotesk,system-ui,sans-serif] bg-[#080F12] min-h-screen text-[#A8C8C8]">
      <div className="flex justify-between mb-5 gap-3">
        <button type="button" onClick={() => navigate('/rotaciones')} className="text-sm text-teal-300">← Estrategias</button>
        <button type="button" onClick={refresh} disabled={refreshing || saving} className="text-sm text-teal-300 disabled:opacity-50">{refreshing ? 'Actualizando...' : 'Actualizar'}</button>
      </div>
      <label className="block"><span className="sr-only">Nombre de la estrategia</span><input value={name} maxLength={120} disabled={strategy.isClosed || saving} onChange={event => setName(event.target.value)} className="bg-transparent w-full text-2xl text-[#F0FAFA] font-bold outline-none" /></label>
      <p className="text-xs mt-2 mb-4">Iniciada: {strategy.tradeDate} · Historial desde: {strategy.ledgerOpening.asOfDate}{strategy.isClosed ? ' · Cerrada' : ''}</p>
      <div className="flex gap-2 mb-4">{['ARS', 'USD'].map(currency => <button type="button" key={currency} aria-pressed={currency === viewCurrency} onClick={() => setViewCurrency(currency)} className={`px-4 py-2 rounded-lg ${currency === viewCurrency ? 'bg-teal-400/15 text-teal-300' : 'bg-[#0C1518]'}`}>{currency}</button>)}</div>
      {error && <p role="alert" className="text-red-300 text-sm mb-4">{error}</p>}
      {notice && <p role="status" className="text-teal-300 text-sm mb-4">{notice}</p>}
      {calculationError && <p role="alert" className="text-red-300 text-sm mb-4">{calculationError}</p>}
      <section className={CARD}>
        <h2 className="text-lg font-bold text-[#F0FAFA]">Posiciones activas</h2>
        <p className="text-xs mt-2">La venta reduce proporcionalmente el costo remanente de los títulos que siguen abiertos. Este cálculo excluye efectivo y resultados realizados; ambos se conservan en el patrimonio y resultado total de la estrategia.</p>
        <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
          <div><p>Base inicial activa</p><strong>{money(viewCurrency === 'USD' ? metrics?.activePositionCostUSD : metrics?.activePositionCostARS, viewCurrency)}</strong></div>
          <div><p>Valor de mercado</p><strong className="text-teal-300">{money(viewCurrency === 'USD' ? metrics?.activePositionValueUSD : metrics?.activePositionValueARS, viewCurrency)}</strong></div>
          <div><p>Resultado abierto</p><strong className={metrics?.activePositionResultUSD != null && new D(metrics.activePositionResultUSD).isNegative() ? 'text-red-300' : 'text-teal-300'}>{money(viewCurrency === 'USD' ? metrics?.activePositionResultUSD : metrics?.activePositionResultARS, viewCurrency)}</strong></div>
          <div><p>Rendimiento abierto</p><strong>{percent(metrics?.activePositionReturnPct)}</strong></div>
        </div>
      </section>
      <section className={CARD}>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div><p>Capital inicial original</p><strong className="block mt-2 text-[#F0FAFA] break-words">{money(viewCurrency === 'USD' ? metrics?.initialUSD : metrics?.initialARS, viewCurrency)}</strong></div>
          <div><p>Patrimonio actual</p><strong className="block mt-2 text-teal-300 break-words">{money(viewCurrency === 'USD' ? metrics?.totalUSD : metrics?.totalARS, viewCurrency)}</strong></div>
          <div><p>Resultado total</p><strong className="block mt-2 text-[#F0FAFA] break-words">{money(viewCurrency === 'USD' ? metrics?.resultUSD : metrics?.resultARS, viewCurrency)}</strong></div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-5 text-center text-xs">{[['REND. USD', metrics?.pUSD], ['REND. ARS', metrics?.pARS], ['ALFA', metrics?.pALFA]].map(([label, value]) => <div key={label} className="bg-[#0C1518] rounded-xl py-3"><p>{label}</p><strong className={`block text-lg mt-1 ${value == null ? '' : value < 0 ? 'text-red-300' : 'text-teal-300'}`}>{percent(value, label === 'ALFA' ? ' p.p.' : '%')}</strong></div>)}</div>
        {metrics?.hasFlows && <p className="text-xs mt-3">Rendimiento simple: incluye lo retirado y descuenta lo aportado al dólar de cada movimiento. La referencia recibe los mismos movimientos de capital.</p>}
        {metrics?.flows.benchmarkIssue && <p className="text-xs text-amber-300 mt-3">{metrics.flows.benchmarkIssue}</p>}
      </section>

      <section className={CARD}>
        <h2 className="text-lg font-bold text-[#F0FAFA]">Comparación Alfa y Delta</h2>
        <p className="text-xs mt-2">Compara el saldo actual con la referencia original, ajustada por los mismos aportes y retiros en sus fechas.</p>
        <div className="grid grid-cols-2 gap-3 mt-4 text-sm"><div><p>Referencia actual</p><strong>{money(viewCurrency === 'USD' ? metrics?.benchmarkUSD : metrics?.benchmarkARS, viewCurrency)}</strong></div><div><p>Delta frente a la referencia</p><strong className={metrics?.deltaUSD != null && new D(metrics.deltaUSD).isNegative() ? 'text-red-300' : 'text-teal-300'}>{money(viewCurrency === 'USD' ? metrics?.deltaUSD : metrics?.deltaARS, viewCurrency)}</strong></div></div>
        {strategy.benchmarkCash && <p className="text-xs mt-3">Caución asignada como referencia: {money(strategy.benchmarkCash.USD, 'USD')}. El nominal en dólares se mantiene fijo; se valúa al dólar actual.</p>}
        {metrics?.hasFlows && <p className="text-xs mt-2">Movimientos netos a sus fechas (aportes menos retiros): {money(metrics.flows.netUSD, 'USD')}. Factor de capital restante en la referencia: {formatStrategyAmount(new D(metrics.flows.factor).times(100).toFixed())}%.</p>}
        <p className="text-sm mt-3">Rendimiento de referencia USD: {percent(metrics?.pBenchmarkUSD)}</p>
        <p className="text-xs mt-2">Alfa = diferencia en dólares / capital inicial en dólares. Se expresa en puntos porcentuales.</p>
        <p className="text-xs mt-2">Resultado de la inversión antes de intereses de caución. Los saldos globales de deuda y efectivo continúan independientes.</p>
      </section>
      {metrics?.initialPortfolio && <section className={CARD}>
        <h2 className="text-lg font-bold text-[#F0FAFA]">Cartera inicial sin cambios</h2>
        <p className="text-xs mt-2">Papeles, cantidades y efectivo cargados al inicio ({strategy.initialPortfolio.asOfDate}), sin compras, ventas, aportes ni retiros posteriores. Las cantidades equivalentes contemplan los splits registrados.</p>
        <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
          <div><p>Valor inicial de la cartera</p><strong>{money(viewCurrency === 'USD' ? metrics.initialPortfolio.initialUSD : metrics.initialPortfolio.initialARS, viewCurrency)}</strong></div>
          <div><p>Hoy sin operar</p><strong className="text-teal-300">{money(viewCurrency === 'USD' ? metrics.initialPortfolio.totalUSD : metrics.initialPortfolio.totalARS, viewCurrency)}</strong></div>
        </div>
        <p className="text-sm mt-3">Rendimiento USD: {percent(metrics.initialPortfolio.pUSD)} · ARS: {percent(metrics.initialPortfolio.pARS)}</p>
        <p className="text-xs mt-2">Valuación por precios; no incluye dividendos ni intereses del efectivo. El valor inicial suma los precios de compra y el efectivo registrados.</p>
        {initialEstimated.length > 0 && <p className="text-xs text-amber-300 mt-2">Sin cotización: {initialEstimated.join(', ')}. Se usa el precio original equivalente; completá las cotizaciones antes de guardar.</p>}
        <details className="mt-4"><summary className="cursor-pointer text-sm font-bold">Ver cartera original y cotizaciones</summary>
          <p className="text-xs mt-3">Efectivo original: {money(metrics.initialPortfolio.cash.ARS, 'ARS')} · {money(metrics.initialPortfolio.cash.USD, 'USD')}</p>
          {metrics.initialPortfolio.positions.map(position => <article key={positionKey(position)} className="mt-3 pt-3 border-t border-teal-400/10 text-sm">
            <p className="text-[#F0FAFA] font-bold">{position.ticker}</p>
            <p>Cantidad original: {formatStrategyAmount(position.originalQuantity, 4)}</p>
            {position.adjustments.length > 0 && <p className="text-teal-300">Equivalente actual: {formatStrategyAmount(position.quantity, 4)} · {position.adjustments.map(action => `${action.quantityNumerator}:${action.quantityDenominator} desde ${action.effectiveDate}`).join('; ')}</p>}
            <label className="block mt-2">Precio actual ({position.currency})<input type="text" inputMode="decimal" disabled={strategy.isClosed || saving} value={initialPrices[positionKey(position)] ?? ''} onChange={event => { setInitialPrices(current => ({ ...current, [positionKey(position)]: event.target.value })); setInitialEstimated(current => current.filter(key => key !== positionKey(position))); }} className={INPUT} /></label>
            <p className="mt-2">Valor hoy: {money(viewCurrency === 'USD' ? position.valueUSD : position.valueARS, viewCurrency)}</p>
          </article>)}
        </details>
      </section>}
      <section className={CARD}>
        <h2 className="text-lg font-bold text-[#F0FAFA]">Efectivo y resultado realizado</h2>
        <p className="text-xs mt-1">Desde el saldo de apertura</p>
        {['ARS', 'USD'].map(currency => <div key={currency} className="grid grid-cols-2 gap-3 mt-4 text-sm"><div><p>Efectivo {currency}</p><strong className="text-teal-300">{money(balances.cash[currency], currency)}</strong></div><div><p>Resultado realizado</p><strong className="text-[#F0FAFA]">{money(balances.realizedResult[currency], currency)}</strong></div></div>)}
      </section>
      <section className={CARD}>
        <div className="flex justify-between gap-3 items-center"><h2 className="text-lg font-bold text-[#F0FAFA]">Posición actual</h2>{!strategy.isClosed && <button type="button" disabled={showForm || saving || refreshing} onClick={() => { setShowForm(true); setNotice(''); }} className="bg-teal-400 text-[#080F12] px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-50">+ Operación</button>}</div>
        {balances.positions.length === 0 && <p className="text-sm mt-4">No quedan títulos en esta estrategia.</p>}
        {balances.positions.map(position => {
          const key = positionKey(position);
          const value = metrics ? new D(position.quantity).times(canonicalPrices[key]).div(position.priceDivisor).toFixed() : null;
          return <article key={key} className="mt-4 pt-4 border-t border-teal-400/10">
            <h3 className="text-[#F0FAFA] font-bold">{position.ticker} <span className="text-xs text-[#A8C8C8]">{position.currency}</span></h3>
            <p className="text-sm mt-1">Cantidad: {formatStrategyAmount(position.quantity, 4)}</p>
            <label className="block text-sm mt-3">Precio actual ({position.currency}{position.priceDivisor === '100' ? ' por 100 nominales' : ''})<input type="text" inputMode="decimal" value={prices[key] ?? ''} disabled={strategy.isClosed || saving} onChange={event => { setPrices(current => ({ ...current, [key]: event.target.value })); setEstimated(current => current.filter(item => item !== key)); }} className={INPUT} /></label>
            <div className="grid grid-cols-2 gap-3 text-sm mt-3"><div><p>Costo remanente</p><strong>{metrics ? money(convert(position.costBasis, position.currency), viewCurrency) : '—'}</strong></div><div><p>Valor actual</p><strong className="text-teal-300">{metrics ? money(convert(value, position.currency), viewCurrency) : '—'}</strong></div></div>
          </article>;
        })}
        {estimated.length > 0 && <p className="text-sm text-amber-300 mt-4">Falta cotización para {estimated.join(', ')}. Se muestra el costo como referencia; ingresá el precio actual antes de guardar una valuación.</p>}
      </section>
      {showForm && <StrategyOperationForm strategy={strategy} records={records} balances={balances} onSave={addOperation} onCancel={() => setShowForm(false)} />}
      <StrategyOperationHistory strategy={strategy} records={records} disabled={saving || refreshing || showForm} onCancelOperation={cancelOperation} />
      <details className={`${CARD} mt-4`}><summary className="cursor-pointer text-[#F0FAFA] font-bold">Activos iniciales vendidos · Referencia Delta y Alfa</summary><div className="space-y-3 mt-4">{(strategy.soldAssets ?? []).map((asset, index) => {
        if (!asset.ticker?.trim()) return null;
        const reference = metrics?.benchmarkPositions[index];
        return <article key={index} className="text-sm">
          <p>{asset.ticker} · Cantidad vendida: {formatStrategyAmount(asset.quantity ?? 0, 4)}</p>
          {reference?.adjustments.length > 0 && <div className="text-teal-300 mt-1">
            <p>Cantidad equivalente actual: {formatStrategyAmount(reference.quantity, 4)}</p>
            {reference.adjustments.map(adjustment => <p key={adjustment.id}>Ajuste {adjustment.quantityNumerator}:{adjustment.quantityDenominator} desde {adjustment.effectiveDate}. {adjustment.note}</p>)}
          </div>}
          {metrics?.hasFlows && !metrics.flows.benchmarkIssue && reference && <p className="text-xs mt-1">Cantidad de referencia tras aportes y retiros: {formatStrategyAmount(new D(reference.quantity).times(metrics.flows.factor).toFixed(), 4)}</p>}
          <label className="block mt-2">Precio actual de referencia (ARS)<input type="text" inputMode="decimal" disabled={strategy.isClosed || saving} value={soldPrices[asset.ticker.trim().toUpperCase()] ?? ''} onChange={event => setSoldPrices(current => ({ ...current, [asset.ticker.trim().toUpperCase()]: event.target.value }))} className={INPUT} /></label>
        </article>;
      })}</div></details>
      <section className={CARD}><label className="block text-sm">Dólar para la valuación<input type="text" inputMode="decimal" disabled={strategy.isClosed || saving} value={usdRate} onChange={event => setUsdRate(event.target.value)} className={INPUT} /></label>
        <button type="button" disabled={saving || refreshing || !metrics || (!strategy.isClosed && (estimated.length > 0 || initialEstimated.length > 0)) || showForm} onClick={() => saveSettings(false)} className="w-full mt-4 bg-teal-400 text-[#080F12] rounded-xl py-3 font-bold disabled:opacity-50">{saving ? 'Guardando...' : strategy.isClosed ? 'Reabrir estrategia' : 'Guardar precios y registrar valuación'}</button>
        {!strategy.isClosed && <button type="button" disabled={saving || refreshing || !metrics || estimated.length > 0 || initialEstimated.length > 0 || showForm} onClick={() => { if (window.confirm('¿Cerrar la estrategia y conservar su historial y saldos?')) saveSettings(true); }} className="block mt-3 mx-auto text-sm text-red-300 disabled:opacity-50">Cerrar estrategia</button>}
      </section>
      <details className={CARD}><summary className="font-bold text-[#F0FAFA] cursor-pointer">Historial de valuaciones ({strategy.priceHistory?.length ?? 0})</summary>
        {[...(strategy.priceHistory ?? [])].reverse().map((entry, index) => {
          const legacyValue = (entry.assetsSnapshot ?? strategy.boughtAssets ?? []).reduce((sum, asset) => sum + parseNum(asset.quantity) * parseNum(entry.prices?.[asset.ticker] ?? asset.priceAtTrade), 0);
          const valueUSD = entry.totalUSD ?? legacyValue / (parseNum(entry.usdRate) || 1);
          return <div key={entry.timestampIso ?? index} className="mt-3 pt-3 border-t border-teal-400/10 text-sm"><p>{entry.date}</p><p className="text-teal-300">{money(valueUSD, 'USD')}</p>{entry.ledgerBalances && <p>Efectivo: {money(entry.ledgerBalances.cash.ARS, 'ARS')} · {money(entry.ledgerBalances.cash.USD, 'USD')}</p>}</div>;
        })}
      </details>
    </main>
  );
}
