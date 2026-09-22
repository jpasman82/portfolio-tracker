import { useMemo, useState } from 'react';
import {
  absoluteAmount,
  amountSign,
  buildLoanFlowChart,
  formatDayMonth,
  formatMonthYear,
  LOAN_FLOW_DEFAULT_EXPANDED,
  loanFlowRows,
} from './loanPresentation';
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
  ['initialValue', 'Primer ingreso'],
  ['netContributions', 'Aportes netos'],
  ['interestToDate', 'Interés hasta hoy'],
  ['projectedFutureInterest', 'Interés futuro'],
  ['projectedMaturityValue', 'Total al vencimiento'],
]);

function eventLabel(event) {
  return event.kinds
    .filter((kind) => kind !== 'today' || event.kinds.length === 1)
    .map((kind) => EVENT_LABELS[kind])
    .join(' · ');
}

function signedMoney(currency, value) {
  const sign = amountSign(value);
  if (sign === 0) return '—';
  return `${sign > 0 ? '+' : '−'} ${formatMoney(currency, absoluteAmount(value))}`;
}

function rowClass(base, row) {
  const event = row.event;
  return [
    base,
    `${base}--${event ? event.phase : row.phase}`,
    event?.isToday ? `${base}--today` : '',
    event?.isMaturity ? `${base}--maturity` : '',
    row.kind === 'group' ? `${base}--group` : '',
  ].filter(Boolean).join(' ');
}

function FlowChart({ chart, currency, labels }) {
  return (
    <div className="loan-chart">
      <div className="loan-chart__bounds">
        <span>{formatMoney(currency, chart.maximumValue)} <em>máx</em></span>
        <span><em>mín</em> {formatMoney(currency, chart.minimumValue)}</span>
      </div>
      <svg
        className="loan-chart__svg"
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Saldo del préstamo entre ${formatDateOnly(chart.firstDate)} y ${formatDateOnly(chart.lastDate)}: realizado hasta hoy y proyectado al vencimiento.`}
      >
        <line x1="0" y1={chart.startPoint.y} x2={chart.width} y2={chart.startPoint.y} className="loan-chart__grid" />
        <line x1="0" y1={chart.maturityPoint.y} x2={chart.width} y2={chart.maturityPoint.y} className="loan-chart__grid" />
        {chart.todayX !== null && (
          <line x1={chart.todayX} y1="0" x2={chart.todayX} y2={chart.height} className="loan-chart__today-line" />
        )}
        {chart.actualLine && (
          <polyline points={chart.actualLine} className="loan-chart__line loan-chart__line--actual" />
        )}
        {chart.projectedLine && (
          <polyline points={chart.projectedLine} className="loan-chart__line loan-chart__line--projected" />
        )}
        {chart.movementPoints.map((point) => (
          <circle key={`m-${point.date}`} cx={point.x} cy={point.y} r="4" className="loan-chart__dot loan-chart__dot--movement" />
        ))}
        {chart.todayPoint && (
          <circle cx={chart.todayPoint.x} cy={chart.todayPoint.y} r="5" className="loan-chart__dot loan-chart__dot--today" />
        )}
        <circle
          cx={chart.maturityPoint.x}
          cy={chart.maturityPoint.y}
          r="4.5"
          className={`loan-chart__dot loan-chart__dot--maturity-${chart.maturityPoint.phase}`}
        />
      </svg>
      <div className="loan-chart__axis">
        <span>{formatMonthYear(chart.firstDate)}</span>
        {labels.today && <span className="loan-chart__axis-today">Hoy · {formatMonthYear(labels.today)}</span>}
        <span>{formatMonthYear(chart.lastDate)}</span>
      </div>
      <div className="loan-chart__legend">
        <span className="loan-legend__item"><span className="loan-legend__swatch loan-legend__swatch--actual" aria-hidden="true" />Realizado</span>
        <span className="loan-legend__item"><span className="loan-legend__swatch loan-legend__swatch--projected" aria-hidden="true" />Proyectado</span>
        <span className="loan-legend__item"><span className="loan-legend__swatch loan-legend__swatch--today" aria-hidden="true" />Hoy</span>
      </div>
    </div>
  );
}

function DesktopRow({ row, currency }) {
  if (row.kind === 'group') {
    return (
      <tr className={rowClass('loan-flow-event', row)}>
        <td className="loan-flow-table__date">
          {formatDateOnly(row.fromDate)} – {formatDateOnly(row.toDate)}
        </td>
        <td>
          {row.count} capitalizaciones
          {row.phase === 'projected' && <span className="loan-flow-tag"> · proyectado</span>}
        </td>
        <td>{formatMoney(currency, row.openingValue)}</td>
        <td>{formatMoney(currency, row.interestForInterval)}</td>
        <td>—</td>
        <td className="loan-flow-table__closing">{formatMoney(currency, row.closingValue)}</td>
      </tr>
    );
  }

  const { event } = row;
  // The opening event has no prior balance and no interval behind it; an
  // em dash says that more honestly than a zero amount.
  const zeroAsDash = (value) => (amountSign(value) === 0 ? '—' : formatMoney(currency, value));
  return (
    <tr className={rowClass('loan-flow-event', row)}>
      <td className="loan-flow-table__date">{formatDateOnly(event.date)}</td>
      <td>
        {eventLabel(event)}
        {event.phase === 'projected' && <span className="loan-flow-tag"> · proyectado</span>}
      </td>
      <td>{zeroAsDash(event.openingValue)}</td>
      <td>{zeroAsDash(event.interestForInterval)}</td>
      <td className={amountSign(event.movementAmount) < 0 ? 'loan-flow-negative' : ''}>
        {signedMoney(currency, event.movementAmount)}
      </td>
      <td className="loan-flow-table__closing">{formatMoney(currency, event.closingValue)}</td>
    </tr>
  );
}

function TimelineRow({ row, currency }) {
  if (row.kind === 'group') {
    const from = formatDayMonth(row.fromDate);
    const to = formatDayMonth(row.toDate);
    return (
      <div className={rowClass('loan-timeline-row', row)}>
        <div className="loan-timeline-row__date">{from.month}<br />–{to.month}</div>
        <div className="loan-timeline-row__body loan-timeline-row__body--inline">
          <span>{row.count} capitalizaciones</span>
          <span className="loan-timeline-row__amount">
            + {formatMoney(currency, row.interestForInterval)}
          </span>
        </div>
      </div>
    );
  }

  const { event } = row;
  const { day, month } = formatDayMonth(event.date);
  const hasMovement = amountSign(event.movementAmount) !== 0;
  // The opening event has no balance behind it and no interval to accrue over;
  // printing two zeroes there is noise, not information.
  const hasOpening = amountSign(event.openingValue) !== 0;
  const hasInterest = amountSign(event.interestForInterval) !== 0;
  return (
    <div className={rowClass('loan-timeline-row', row)}>
      <div className="loan-timeline-row__date">{day}<br />{month}</div>
      <div className="loan-timeline-row__body">
        <p className="loan-timeline-row__title">{eventLabel(event)}</p>
        <dl className="loan-timeline-row__values">
          {hasOpening && (
            <div><dt>Saldo anterior</dt><dd>{formatMoney(currency, event.openingValue)}</dd></div>
          )}
          {hasInterest && (
            <div><dt>Interés del tramo</dt><dd>{formatMoney(currency, event.interestForInterval)}</dd></div>
          )}
          {hasMovement && (
            <div>
              <dt>Movimiento</dt>
              <dd className={amountSign(event.movementAmount) < 0 ? 'loan-flow-negative' : ''}>
                {signedMoney(currency, event.movementAmount)}
              </dd>
            </div>
          )}
          <div className="loan-timeline-row__closing">
            <dt>Saldo final</dt>
            <dd>{formatMoney(currency, event.closingValue)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function PhaseHeading({ phase }) {
  return (
    <div className={`loan-phase-heading loan-phase-heading--${phase}`}>
      <span>{phase === 'actual' ? 'Realizado' : 'Proyectado'}</span>
      <span className="loan-phase-heading__rule" aria-hidden="true" />
    </div>
  );
}

export default function LoanFlow({ loan, timeline, asOfDate }) {
  const [expanded, setExpanded] = useState(LOAN_FLOW_DEFAULT_EXPANDED);

  const { rows, canSummarise } = useMemo(
    () => loanFlowRows({ events: timeline.events, expanded }),
    [timeline.events, expanded],
  );
  const chart = useMemo(
    () => buildLoanFlowChart({ events: timeline.events, asOfDate }),
    [timeline.events, asOfDate],
  );

  const actualRows = rows.filter((row) => (row.event ? row.event.phase : row.phase) === 'actual');
  const projectedRows = rows.filter((row) => (row.event ? row.event.phase : row.phase) === 'projected');

  return (
    <section className="loan-flow" aria-labelledby="loan-flow-heading">
      <div className="loan-flow__heading">
        <div>
          <h2 id="loan-flow-heading">Flujo del préstamo</h2>
          <p className="loan-flow__intro">
            Cómo el saldo llega desde el primer ingreso hasta la proyección. La línea sólida es lo realizado; la punteada, lo proyectado con la tasa vigente y sin nuevos movimientos.
          </p>
        </div>
      </div>

      <div className="loan-flow__panel">
        {chart
          ? <FlowChart chart={chart} currency={loan.currency} labels={{ today: timeline.asOfEvent?.date }} />
          : (
            <p className="loan-note">
              El gráfico aparece cuando el préstamo tiene al menos dos eventos en su recorrido.
            </p>
          )}
        <dl className="loan-flow-totals">
          {SUMMARY_ITEMS.map(([field, label]) => (
            <div key={field} className={`loan-flow-totals__item loan-flow-totals__item--${field}`}>
              <dt>{label}</dt>
              <dd>{formatMoney(loan.currency, timeline.summary[field])}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="loan-flow-table-wrap">
        <table className="loan-flow-table">
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Evento</th>
              <th scope="col">Saldo inicial</th>
              <th scope="col">Interés</th>
              <th scope="col">Movimiento</th>
              <th scope="col">Saldo final</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => <DesktopRow key={row.key} row={row} currency={loan.currency} />)}
          </tbody>
        </table>
      </div>

      <div className="loan-timeline">
        {actualRows.length > 0 && <PhaseHeading phase="actual" />}
        {actualRows.map((row) => <TimelineRow key={row.key} row={row} currency={loan.currency} />)}
        {projectedRows.length > 0 && <PhaseHeading phase="projected" />}
        {projectedRows.map((row) => <TimelineRow key={row.key} row={row} currency={loan.currency} />)}
      </div>

      <div className="loan-flow__footer">
        <p className="loan-note">
          {expanded || !canSummarise
            ? `Se muestran los ${timeline.events.length} eventos del recorrido.`
            : 'Los tramos de capitalizaciones consecutivas se agrupan para acortar la lectura.'}
          {' La proyección supone que no se registran nuevos ingresos ni retiros.'}
        </p>
        {canSummarise && (
          <button
            type="button"
            className="loan-button loan-button--secondary loan-button--compact"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Resumir flujo' : 'Ver flujo completo'}
          </button>
        )}
      </div>
    </section>
  );
}
