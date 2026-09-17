import { useState } from 'react';
import Decimal from 'decimal.js';
import { collapsedLoanTimelineEvents } from './loanTimeline';
import { formatDateOnly, formatMoney } from './loanUi';

const EVENT_LABELS = Object.freeze({
  start: 'Inicio',
  capitalization: 'Capitalización',
  contribution: 'Ingreso',
  withdrawal: 'Retiro',
  today: 'Hoy',
  maturity: 'Vencimiento',
});

const SUMMARY_ITEMS = Object.freeze([
  ['initialValue', 'Valor inicial / primer ingreso'],
  ['netContributions', 'Ingresos netos'],
  ['interestToDate', 'Intereses generados hasta hoy'],
  ['currentValue', 'Valor actual'],
  ['projectedFutureInterest', 'Interés futuro estimado'],
  ['projectedMaturityValue', 'Proyección al vencimiento'],
]);

function eventLabel(event) {
  return event.kinds
    .filter((kind) => kind !== 'today' || event.kinds.length === 1)
    .map((kind) => EVENT_LABELS[kind])
    .join(' · ');
}

function signedMoney(currency, value) {
  const amount = new Decimal(value);
  if (amount.isZero()) return '—';
  return `${amount.isPositive() ? '+' : '−'} ${formatMoney(currency, amount.abs().toString())}`;
}

function flowClass(event) {
  return [
    'loan-flow-event',
    `loan-flow-event--${event.phase}`,
    event.isToday ? 'loan-flow-event--today' : '',
    event.isMaturity ? 'loan-flow-event--maturity' : '',
  ].filter(Boolean).join(' ');
}

function EventBadges({ event }) {
  return (
    <span className="loan-flow-event__badges">
      <span className={`loan-flow-phase loan-flow-phase--${event.phase}`}>
        {event.phase === 'actual' ? 'Real' : 'Proyectado'}
      </span>
      {event.isToday ? <span className="loan-flow-phase loan-flow-phase--today">Hoy</span> : null}
    </span>
  );
}

function DesktopRow({ event, currency }) {
  return (
    <tr className={flowClass(event)}>
      <td>{formatDateOnly(event.date)}</td>
      <td>
        <strong>{eventLabel(event)}</strong>
        <EventBadges event={event} />
      </td>
      <td>{formatMoney(currency, event.openingValue)}</td>
      <td>{formatMoney(currency, event.interestForInterval)}</td>
      <td className={new Decimal(event.movementAmount).isNegative() ? 'loan-flow-negative' : ''}>
        {signedMoney(currency, event.movementAmount)}
      </td>
      <td>{formatMoney(currency, event.closingValue)}</td>
    </tr>
  );
}

function MobileCard({ event, currency }) {
  return (
    <article className={flowClass(event)}>
      <header className="loan-flow-card__header">
        <div>
          <time dateTime={event.date}>{formatDateOnly(event.date)}</time>
          <h3>{eventLabel(event)}</h3>
        </div>
        <EventBadges event={event} />
      </header>
      <dl className="loan-flow-card__values">
        <div><dt>Saldo anterior</dt><dd>{formatMoney(currency, event.openingValue)}</dd></div>
        <div><dt>Interés tramo</dt><dd>{formatMoney(currency, event.interestForInterval)}</dd></div>
        <div><dt>Movimiento</dt><dd>{signedMoney(currency, event.movementAmount)}</dd></div>
        <div><dt>Saldo final</dt><dd>{formatMoney(currency, event.closingValue)}</dd></div>
      </dl>
    </article>
  );
}

function withGaps(allEvents, visibleEvents) {
  const indexes = visibleEvents.map((event) => allEvents.indexOf(event));
  return visibleEvents.flatMap((event, index) => {
    const hasGap = index > 0 && indexes[index] - indexes[index - 1] > 1;
    return hasGap
      ? [{ gap: true, key: `gap-${event.date}` }, { event, key: event.date }]
      : [{ event, key: event.date }];
  });
}

export default function LoanFlow({ loan, timeline }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = timeline.events.length > 10;
  const visibleEvents = expanded || !collapsible
    ? timeline.events
    : collapsedLoanTimelineEvents(timeline.events);
  const entries = withGaps(timeline.events, visibleEvents);

  return (
    <section className="loan-detail-section loan-flow" aria-labelledby="loan-flow-heading">
      <div className="loan-flow__heading">
        <div>
          <p className="loan-kicker">Recorrido financiero completo</p>
          <h2 id="loan-flow-heading">Flujo del préstamo</h2>
        </div>
        <div className="loan-flow__legend" aria-label="Fases del flujo">
          <span className="loan-flow-phase loan-flow-phase--actual">Real</span>
          <span className="loan-flow-phase loan-flow-phase--projected">Proyectado</span>
        </div>
      </div>

      <div className="loan-flow-summary" aria-label="Resumen del flujo">
        {SUMMARY_ITEMS.map(([field, label]) => (
          <div key={field}>
            <span>{label}</span>
            <strong>{formatMoney(loan.currency, timeline.summary[field])}</strong>
          </div>
        ))}
      </div>

      <p className="loan-flow__projection-note">
        La proyección futura supone que no se registran nuevos ingresos ni retiros.
      </p>

      <div className="loan-flow-table-wrap">
        <table className="loan-flow-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Evento</th>
              <th>Saldo inicial</th>
              <th>Interés</th>
              <th>Movimiento</th>
              <th>Saldo final</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => entry.gap ? (
              <tr key={entry.key} className="loan-flow-gap" aria-hidden="true">
                <td colSpan="6">•••</td>
              </tr>
            ) : (
              <DesktopRow key={entry.key} event={entry.event} currency={loan.currency} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="loan-flow-cards">
        {entries.map((entry) => entry.gap ? (
          <div key={entry.key} className="loan-flow-gap" aria-hidden="true">•••</div>
        ) : (
          <MobileCard key={entry.key} event={entry.event} currency={loan.currency} />
        ))}
      </div>

      {collapsible ? (
        <button
          type="button"
          className="loan-button loan-button--secondary loan-flow__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Ver flujo resumido' : 'Ver flujo completo'}
        </button>
      ) : null}
    </section>
  );
}
