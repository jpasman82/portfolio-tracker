import { useState } from 'react';
import { prepareStrategyCancellation } from './strategyLedger';
import { formatStrategyAmount } from './strategyUi';

const TYPES = { sell: 'Venta', buy: 'Compra', contribution: 'Aporte', withdrawal: 'Retiro' };

export default function StrategyOperationHistory({ strategy, records, disabled, onCancelOperation }) {
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function review(event) {
    event.preventDefault();
    setError('');
    try {
      const prepared = prepareStrategyCancellation({ opening: strategy.ledgerOpening, records, operationId: selected, reason });
      setPreview({ ...prepared, revision: strategy.ledgerRevision });
    } catch (cause) { setError(`No se puede anular: ${cause.message} Revisá las operaciones posteriores que dependan de ésta.`); }
  }
  async function confirm() {
    setSaving(true);
    setError('');
    try {
      await onCancelOperation(selected, preview.reason, preview.revision);
      setSelected(null); setPreview(null); setReason('');
    } catch (cause) { setError(cause.message); setPreview(null); }
    finally { setSaving(false); }
  }

  const currentPreview = preview?.revision === strategy.ledgerRevision ? preview : null;

  return (
    <section className="bg-[#122329] border border-teal-400/15 rounded-2xl p-5 mt-4">
      <h2 className="text-lg font-bold text-[#F0FAFA]">Historial de operaciones</h2>
      <p className="text-xs text-[#A8C8C8] mt-2">Para corregir una carga, anulala con un motivo y registrá la operación correcta. El registro original se conserva.</p>
      {records.length === 0 && <p className="text-sm text-[#A8C8C8] mt-4">Todavía no hay operaciones registradas.</p>}
      {[...records].reverse().map(record => (
        <article key={record.id} className="mt-4 pt-4 border-t border-teal-400/15 text-sm">
          <div className="flex justify-between items-start gap-3">
            <div><h3 className="font-bold text-[#F0FAFA]">{TYPES[record.type]} {record.ticker ?? ''}</h3><p className="text-[#A8C8C8]">{record.tradeDate} · Orden {record.sequence}</p></div>
            <span className={record.status === 'cancelled' ? 'text-red-300' : 'text-teal-300'}>{record.status === 'cancelled' ? 'Anulada' : 'Registrada'}</span>
          </div>
          <div className="text-[#A8C8C8] space-y-1 mt-3">
            {record.quantity && <p>Cantidad: {formatStrategyAmount(record.quantity, 4)} · Precio: {record.currency} {formatStrategyAmount(record.price, 8)}</p>}
            {record.fees != null && <p>Gastos: {record.currency} {formatStrategyAmount(record.fees)}</p>}
            <p>Neto: {record.currency} {formatStrategyAmount(record.netAmount ?? record.amount)}</p>
            {record.usdRateAtTrade && <p>Dólar del movimiento: $ {formatStrategyAmount(record.usdRateAtTrade)}</p>}
            {record.benchmarkValueARSAtTrade && <p>Referencia original en esa fecha: $ {formatStrategyAmount(record.benchmarkValueARSAtTrade)}</p>}
            {record.sourceOperationId && <p>Boleto: {record.sourceOperationId}{record.broker ? ` · ${record.broker}` : ''}</p>}
            {record.settlementDate && <p>Liquidación: {record.settlementDate}</p>}
            {record.note && <p className="whitespace-pre-wrap">{record.note}</p>}
            {record.linkedTransferId && <p className="text-xs">Vinculada a la nueva rotación. Una corrección debe conservar la transferencia entre ambas estrategias.</p>}
            {record.recordedAt?.toDate && <p className="text-xs">Cargada: {record.recordedAt.toDate().toLocaleString('es-AR')}</p>}
            {record.status === 'cancelled' && <p className="text-red-300 whitespace-pre-wrap">Motivo: {record.cancellationReason}</p>}
          </div>
          {!strategy.isClosed && record.status === 'active' && !record.linkedTransferId && selected !== record.id && <button type="button" disabled={saving || disabled} onClick={() => { setSelected(record.id); setReason(''); setPreview(null); setError(''); }} className="mt-3 text-red-300 underline underline-offset-4">Anular operación</button>}
          {selected === record.id && (
            <form onSubmit={review} className="mt-4 space-y-3">
              <label className="block text-[#A8C8C8]">Motivo de anulación<textarea required maxLength={500} disabled={saving || disabled} value={reason} onChange={event => { setReason(event.target.value); setPreview(null); }} className="block mt-1 w-full bg-[#0C1518] text-[#F0FAFA] p-3 border border-red-400/25 rounded-xl" /></label>
              {error && <p role="alert" className="text-red-300">{error}</p>}
              {currentPreview && <p aria-live="polite" className="text-[#A8C8C8]">Efectivo después de anular: {record.currency} {formatStrategyAmount(currentPreview.balances.cash[record.currency])}</p>}
              <div className="flex gap-3">
                {currentPreview ? <button type="button" disabled={saving || disabled} onClick={confirm} className="px-3 py-2 bg-red-400/15 text-red-300 rounded-lg disabled:opacity-50">{saving ? 'Guardando...' : 'Confirmar anulación'}</button> : <button type="submit" disabled={saving || disabled} className="px-3 py-2 bg-red-400/15 text-red-300 rounded-lg">Revisar anulación</button>}
                <button type="button" disabled={saving || disabled} onClick={() => { setSelected(null); setPreview(null); }} className="text-[#A8C8C8]">Volver</button>
              </div>
            </form>
          )}
        </article>
      ))}
    </section>
  );
}
