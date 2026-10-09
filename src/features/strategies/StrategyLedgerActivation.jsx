import { useState } from 'react';
import { db, auth } from '../../firebase/config';
import { createStrategyRepository } from './strategyRepository';
import { createStrategyOpeningFromLegacy } from './strategyLegacy';
import { calculateStrategyLedger, localStrategyDate } from './strategyLedger';
import { formatStrategyAmount } from './strategyUi';

const repository = createStrategyRepository(db);

export default function StrategyLedgerActivation({ strategyId, strategy, disabled, onActivated }) {
  const [expanded, setExpanded] = useState(false);
  const [cutoff, setCutoff] = useState(strategy.tradeDate || localStrategyDate());
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  let opening;
  let balances;
  let previewError = '';
  try {
    opening = createStrategyOpeningFromLegacy(strategy, { asOfDate: cutoff });
    balances = calculateStrategyLedger(opening, []);
  } catch (cause) { previewError = cause.message; }

  async function activate() {
    setSaving(true);
    setError('');
    try {
      if (!auth.currentUser) throw new Error('Iniciá sesión nuevamente para guardar.');
      await repository.activate(strategyId, opening, auth.currentUser.uid);
      onActivated();
    } catch (cause) { setError(cause.message); }
    finally { setSaving(false); }
  }

  return (
    <section className="bg-[#122329] border border-teal-400/20 rounded-2xl p-5 mb-4 relative z-10">
      <h2 className="text-lg font-bold text-[#F0FAFA]">Operaciones de la estrategia</h2>
      <p className="text-sm text-[#A8C8C8] mt-2">Registrá compras y ventas parciales con precio, gastos e historial. El efectivo recibido queda dentro de esta estrategia.</p>
      {!expanded ? (
        <button type="button" disabled={disabled} onClick={() => setExpanded(true)} className="mt-4 px-4 py-2.5 rounded-xl bg-teal-400 text-[#080F12] font-bold disabled:opacity-50">Habilitar historial</button>
      ) : (
        <div className="mt-4 space-y-4">
          <label className="block text-sm text-[#A8C8C8]">Fecha del saldo de apertura
            <input type="date" value={cutoff} min={strategy.tradeDate} max={localStrategyDate()} disabled={saving} onChange={event => { setCutoff(event.target.value); setConfirmed(false); }} className="block w-full mt-2 bg-[#0C1518] border border-teal-400/20 rounded-xl p-3 text-[#F0FAFA]" />
          </label>
          <p className="text-xs text-[#A8C8C8]">Elegí una fecha previa a las operaciones que vas a cargar. Estas son las cantidades y costos actualmente guardados.</p>
          {previewError ? <p role="alert" className="text-red-300 text-sm">{previewError}</p> : (
            <div className="space-y-2 text-sm">
              {balances.positions.map(position => (
                <div key={`${position.ticker}:${position.currency}`} className="flex justify-between gap-3 border-b border-teal-400/10 pb-2">
                  <div><strong className="text-[#F0FAFA]">{position.ticker}</strong><p className="text-[#A8C8C8]">Cantidad: {formatStrategyAmount(position.quantity, 4)}</p></div>
                  <div className="text-right text-[#A8C8C8]">Costo total<p>{position.currency} {formatStrategyAmount(position.costBasis)}</p></div>
                </div>
              ))}
              {['ARS', 'USD'].map(currency => <p key={currency} className="text-[#A8C8C8]">Efectivo {currency}: {formatStrategyAmount(balances.cash[currency])}</p>)}
            </div>
          )}
          <label className="flex items-start gap-3 text-sm text-[#A8C8C8]">
            <input type="checkbox" checked={confirmed} disabled={saving || Boolean(previewError)} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />
            Confirmo que estas cantidades y costos son el saldo previo a las operaciones que voy a cargar.
          </label>
          {error && <p role="alert" className="text-red-300 text-sm">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={activate} disabled={!confirmed || Boolean(previewError) || saving || disabled} className="px-4 py-2.5 rounded-xl bg-teal-400 text-[#080F12] font-bold disabled:opacity-50">{saving ? 'Guardando...' : 'Confirmar apertura'}</button>
            <button type="button" onClick={() => setExpanded(false)} disabled={saving} className="px-4 py-2.5 text-[#A8C8C8]">Cancelar</button>
          </div>
        </div>
      )}
    </section>
  );
}
