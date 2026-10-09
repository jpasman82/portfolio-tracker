import { useState } from 'react';
import { prepareStrategyOperation, localStrategyDate } from './strategyLedger';
import { parseStrategyAmount, formatStrategyAmount } from './strategyUi';
import { cashBenchmarkValueARS } from './strategyCashFlows';

const INPUT = 'block w-full mt-1 bg-[#0C1518] border border-teal-400/20 rounded-xl p-3 text-[#F0FAFA] outline-none focus:border-teal-400/60 disabled:opacity-60';
const TYPES = { sell: 'Venta', buy: 'Compra', contribution: 'Aporte de efectivo', withdrawal: 'Retiro de efectivo' };

export default function StrategyOperationForm({ strategy, records, balances, onSave, onCancel }) {
  const [form, setForm] = useState(() => ({
    id: crypto.randomUUID(), type: 'sell', tradeDate: localStrategyDate(), settlementDate: '',
    ticker: '', currency: 'ARS', quantity: '', price: '', priceDivisor: '1',
    fees: '0', netAmount: '', amount: '', usdRateAtTrade: '', benchmarkValueARSAtTrade: '', sourceOperationId: '', broker: '', note: '', sequence: '',
  }));
  const [netMode, setNetMode] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const cashOnly = ['contribution', 'withdrawal'].includes(form.type);
  let automaticBenchmark = null;
  if (cashOnly && form.usdRateAtTrade) {
    try { automaticBenchmark = cashBenchmarkValueARS(strategy, parseStrategyAmount(form.usdRateAtTrade, 'Dólar')); }
    catch { /* The review step reports invalid input. */ }
  }

  function change(field, value) {
    setForm(current => {
      const next = { ...current, [field]: value };
      if (field === 'ticker' || field === 'currency') {
        const held = balances.positions.find(position => position.ticker === next.ticker.trim().toUpperCase() && position.currency === next.currency);
        next.priceDivisor = held?.priceDivisor ?? '1';
      }
      return next;
    });
    setPreview(null);
    setError('');
  }

  function review(event) {
    event.preventDefault();
    setError('');
    try {
      const input = {
        id: form.id, type: form.type, tradeDate: form.tradeDate, settlementDate: form.settlementDate || null,
        currency: form.currency, sourceOperationId: form.sourceOperationId || null, broker: form.broker || null, note: form.note,
        ...(form.sequence === '' ? {} : { sequence: Number(form.sequence) }),
        ...(cashOnly ? {
          amount: parseStrategyAmount(form.amount, 'Importe'),
          usdRateAtTrade: parseStrategyAmount(form.usdRateAtTrade, 'Dólar de la fecha'),
          benchmarkValueARSAtTrade: automaticBenchmark ?? parseStrategyAmount(form.benchmarkValueARSAtTrade, 'Referencia de la fecha'),
        } : {
          ticker: form.ticker, quantity: parseStrategyAmount(form.quantity, 'Cantidad'), price: parseStrategyAmount(form.price, 'Precio'),
          priceDivisor: form.priceDivisor,
          ...(netMode ? { netAmount: parseStrategyAmount(form.netAmount, 'Neto') } : { fees: parseStrategyAmount(form.fees, 'Gastos') }),
        }),
      };
      const prepared = prepareStrategyOperation({ opening: strategy.ledgerOpening, records, input });
      setPreview({ ...prepared, revision: strategy.ledgerRevision });
    } catch (cause) { setError(cause.message); setPreview(null); }
  }

  async function submit() {
    setSaving(true);
    setError('');
    try { await onSave(preview.operation, preview.revision); }
    catch (cause) { setError(cause.message); setPreview(null); }
    finally { setSaving(false); }
  }

  const currentPreview = preview?.revision === strategy.ledgerRevision ? preview : null;

  return (
    <form onSubmit={review} className="bg-[#122329] border border-teal-400/25 p-5 rounded-2xl space-y-4">
      <h2 className="text-lg font-bold text-[#F0FAFA]">Agregar operación</h2>
      <p className="text-xs text-[#A8C8C8]">Esta operación sólo cambia el saldo de esta estrategia. Los saldos globales se actualizan manualmente. Si el boleto abarca varias estrategias, cargá sólo la parte asignada a ésta.</p>
      <fieldset disabled={saving} className="space-y-4">
        <label className="block text-sm text-[#A8C8C8]">Tipo
          <select value={form.type} onChange={event => change('type', event.target.value)} className={INPUT}>{Object.entries(TYPES).map(([type, name]) => <option key={type} value={type}>{name}</option>)}</select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-[#A8C8C8]">Fecha de concertación<input type="date" required min={strategy.ledgerOpening.asOfDate} max={localStrategyDate()} value={form.tradeDate} onChange={event => change('tradeDate', event.target.value)} className={INPUT} /></label>
          <label className="block text-sm text-[#A8C8C8]">Moneda<select value={form.currency} onChange={event => change('currency', event.target.value)} className={INPUT}><option>ARS</option><option>USD</option></select></label>
        </div>
        <p className="text-xs text-[#A8C8C8]">Efectivo disponible en la estrategia: {form.currency} {formatStrategyAmount(balances.cash[form.currency])}</p>
        {cashOnly ? (
          <>
            <label className="block text-sm text-[#A8C8C8]">Importe<input type="text" inputMode="decimal" required placeholder="1.234,56" value={form.amount} onChange={event => change('amount', event.target.value)} className={INPUT} /></label>
            <label className="block text-sm text-[#A8C8C8]">Dólar MEP de la fecha<input type="text" inputMode="decimal" required value={form.usdRateAtTrade} onChange={event => change('usdRateAtTrade', event.target.value)} className={INPUT} /></label>
            {automaticBenchmark != null
              ? <p className="text-xs text-[#A8C8C8]">Referencia original en esa fecha: $ {formatStrategyAmount(automaticBenchmark)}. Se calcula con los pesos y dólares de referencia.</p>
              : <label className="block text-sm text-[#A8C8C8]">Valor de la referencia original en esa fecha (ARS)<input type="text" inputMode="decimal" required value={form.benchmarkValueARSAtTrade} onChange={event => change('benchmarkValueARSAtTrade', event.target.value)} className={INPUT} /><span className="block mt-1 text-xs">Valor de todos los activos de referencia originales, antes de ajustar aportes o retiros anteriores. Usá las cotizaciones de la fecha del movimiento.</span></label>}
            <p className="text-xs text-[#A8C8C8]">Estos datos permiten comparar la estrategia y su referencia con el mismo movimiento de capital.</p>
          </>
        ) : (
          <>
            <label className="block text-sm text-[#A8C8C8]">Ticker
              <input type="text" required list="strategy-held-tickers" autoComplete="off" value={form.ticker} onChange={event => change('ticker', event.target.value.toUpperCase())} className={INPUT} />
              <datalist id="strategy-held-tickers">{balances.positions.filter(position => position.currency === form.currency).map(position => <option key={position.ticker} value={position.ticker} />)}</datalist>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm text-[#A8C8C8]">Cantidad<input type="text" inputMode="decimal" required value={form.quantity} onChange={event => change('quantity', event.target.value)} className={INPUT} /></label>
              <label className="block text-sm text-[#A8C8C8]">Precio<input type="text" inputMode="decimal" required value={form.price} onChange={event => change('price', event.target.value)} className={INPUT} /></label>
            </div>
            <label className="block text-sm text-[#A8C8C8]">Cotización<select value={form.priceDivisor} onChange={event => change('priceDivisor', event.target.value)} className={INPUT}><option value="1">Precio por unidad</option><option value="100">Precio por 100 nominales</option></select></label>
            <label className="flex items-center gap-2 text-sm text-[#A8C8C8]"><input type="checkbox" checked={netMode} onChange={event => { setNetMode(event.target.checked); setPreview(null); }} />Ingresar el neto del boleto</label>
            <label className="block text-sm text-[#A8C8C8]">{netMode ? 'Importe neto asignado' : 'Gastos totales (comisión, IVA y otros)'}
              <input type="text" inputMode="decimal" required value={netMode ? form.netAmount : form.fees} onChange={event => change(netMode ? 'netAmount' : 'fees', event.target.value)} className={INPUT} />
            </label>
          </>
        )}
        <details className="text-sm text-[#A8C8C8]">
          <summary className="cursor-pointer">Datos del comprobante y orden del día</summary>
          <div className="mt-3 space-y-3">
            <label className="block">Número de boleto<input type="text" maxLength={120} value={form.sourceOperationId} onChange={event => change('sourceOperationId', event.target.value)} className={INPUT} /></label>
            <label className="block">Broker<input type="text" maxLength={80} value={form.broker} onChange={event => change('broker', event.target.value)} className={INPUT} /></label>
            <label className="block">Fecha de liquidación<input type="date" min={form.tradeDate} value={form.settlementDate} onChange={event => change('settlementDate', event.target.value)} className={INPUT} /></label>
            <label className="block">Orden del día (opcional)<input type="number" min="0" step="1" value={form.sequence} onChange={event => change('sequence', event.target.value)} className={INPUT} /></label>
            <p className="text-xs">Dejalo vacío para agregar al final del día. Completalo para insertar antes de otra operación.</p>
          </div>
        </details>
        <label className="block text-sm text-[#A8C8C8]">Nota (opcional)<textarea maxLength={500} value={form.note} onChange={event => change('note', event.target.value)} className={INPUT} /></label>
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {currentPreview && (
        <div aria-live="polite" className="bg-[#0C1518] rounded-xl p-4 text-sm text-[#A8C8C8] space-y-2">
          <strong className="text-[#F0FAFA]">Saldo después de registrar</strong>
          {!cashOnly && <p>{form.ticker.trim().toUpperCase()}: {formatStrategyAmount(currentPreview.balances.positions.find(position => position.ticker === form.ticker.trim().toUpperCase() && position.currency === form.currency)?.quantity ?? 0, 4)} unidades</p>}
          <p>Neto: {form.currency} {formatStrategyAmount(currentPreview.operation.netAmount ?? currentPreview.operation.amount)}</p>
          {!cashOnly && <p>Gastos: {form.currency} {formatStrategyAmount(currentPreview.operation.fees)}</p>}
          <p>Efectivo: {form.currency} {formatStrategyAmount(currentPreview.balances.cash[form.currency])}</p>
          <p>Resultado realizado acumulado: {form.currency} {formatStrategyAmount(currentPreview.balances.realizedResult[form.currency])}</p>
        </div>
      )}
      <div className="flex gap-3 flex-wrap">
        {currentPreview ? <button type="button" disabled={saving} onClick={submit} className="px-4 py-3 rounded-xl bg-teal-400 text-[#080F12] font-bold disabled:opacity-50">{saving ? 'Guardando...' : 'Confirmar y guardar'}</button>
          : <button type="submit" className="px-4 py-3 rounded-xl bg-teal-400 text-[#080F12] font-bold">Revisar operación</button>}
        <button type="button" disabled={saving} onClick={onCancel} className="px-4 py-3 text-[#A8C8C8]">Cancelar</button>
      </div>
    </form>
  );
}
