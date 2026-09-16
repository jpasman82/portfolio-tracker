import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { db } from '../firebase/config';
import AppBottomNav from '../components/AppBottomNav';
import LogoutButton from '../components/LogoutButton';
import LoanMovementForm from '../features/loans/LoanMovementForm';
import LoanMovementDeleteDialog from '../features/loans/LoanMovementDeleteDialog';
import LoanTermsForm from '../features/loans/LoanTermsForm';
import { createLoanRepository } from '../features/loans/loanRepository';
import {
  formatDateOnly,
  formatMoney,
  formatRatePercent,
  loadLoanDetail,
  movementTypeLabel,
  rateTypeLabel,
  statusLabel,
  todayDateOnly,
} from '../features/loans/loanUi';
import { useHideBottomNavOnScroll } from '../utils/useHideBottomNavOnScroll';
import './Activos.css';

const loanRepository = createLoanRepository(db);

function Metric({ label, value, primary = false, children }) {
  return (
    <article className={`loan-metric${primary ? ' loan-metric--primary' : ''}`}>
      <span className="loan-metric__label">{label}</span>
      <p className="loan-metric__value">{value}</p>
      {children}
    </article>
  );
}

function MovementRow({ movement, currency, onEdit, onDelete }) {
  const withdrawal = movement.type === 'withdrawal';
  return (
    <div className={`loan-movement${withdrawal ? ' loan-movement--withdrawal' : ''}`}>
      <div className="loan-movement__main">
        <span className="loan-movement__icon" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d={withdrawal ? 'M12 19V5M5 12l7-7 7 7' : 'M12 5v14M5 12l7 7 7-7'} />
          </svg>
        </span>
        <div>
          <p className="loan-movement__type">{movementTypeLabel(movement.type)}</p>
          <p className="loan-movement__date">{formatDateOnly(movement.effectiveDate)}</p>
          {movement.note && <p className="loan-movement__note">{movement.note}</p>}
        </div>
      </div>
      <div className="loan-movement__actions">
        <p className="loan-movement__amount">
          {withdrawal ? '−' : '+'} {formatMoney(currency, movement.amount)}
        </p>
        {onEdit && (
          <button type="button" className="loan-movement__edit" onClick={() => onEdit(movement)}>
            Editar
          </button>
        )}
        {onDelete && (
          <button type="button" className="loan-movement__delete" onClick={() => onDelete(movement)}>
            Eliminar
          </button>
        )}
      </div>
    </div>
  );
}

export default function LoanDetail({
  currentUser,
  repository = loanRepository,
  initialAsOfDate,
}) {
  const { loanId } = useParams();
  const uid = currentUser?.uid;
  const [asOfDate] = useState(() => initialAsOfDate || todayDateOnly());
  const [presentation, setPresentation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [movementDialog, setMovementDialog] = useState(null);
  const [deleteDialog, setDeleteDialog] = useState(null);
  const [showTermsDialog, setShowTermsDialog] = useState(false);
  const bottomNavHidden = useHideBottomNavOnScroll();

  useEffect(() => {
    let active = true;
    if (!uid) return () => { active = false; };

    loadLoanDetail({ uid, loanId, repository, asOfDate })
      .then((result) => {
        if (!active) return;
        setPresentation(result);
        setNotFound(result === null);
        setError(false);
        setLoading(false);
      })
      .catch((loadError) => {
        console.error('Error loading loan detail', loadError);
        if (!active) return;
        setError(true);
        setNotFound(false);
        setLoading(false);
      });

    return () => { active = false; };
  }, [uid, loanId, repository, asOfDate, reloadKey]);

  const retry = () => {
    setLoading(true);
    setError(false);
    setNotFound(false);
    setReloadKey((value) => value + 1);
  };

  const changesSaved = () => {
    setMovementDialog(null);
    setDeleteDialog(null);
    setShowTermsDialog(false);
    retry();
  };

  let content;
  if (!uid) {
    content = (
      <div className="loan-state" role="status">
        <h2>Sesión no disponible</h2>
        <p>Volvé a ingresar para consultar este préstamo.</p>
      </div>
    );
  } else if (loading) {
    content = (
      <div className="loan-loading" role="status">
        <span className="loan-spinner" aria-hidden="true" />
        Cargando préstamo
      </div>
    );
  } else if (error) {
    content = (
      <div className="loan-state" role="alert">
        <h2>No pudimos abrir este préstamo</h2>
        <p>Puede tratarse de un problema de conexión o de acceso.</p>
        <button type="button" className="loan-button loan-button--secondary" onClick={retry}>Reintentar</button>
      </div>
    );
  } else if (notFound || !presentation) {
    content = (
      <div className="loan-state">
        <h2>Préstamo no encontrado</h2>
        <p>El registro no existe o ya no está disponible.</p>
        <Link className="loan-button loan-button--secondary" to="/activos">Volver a Activos</Link>
      </div>
    );
  } else {
    const { loan, valuation, projection, visibleMovements, effectiveStatus } = presentation;
    const canManageMovements = loan.status === 'active';
    content = (
      <>
        <div className="loan-detail__title-row">
          <div className="loan-detail__identity">
            <p className="loan-kicker">Préstamo · {loan.currency}</p>
            <h1>{loan.name}</h1>
          </div>
          <span className={`loan-badge loan-badge--${effectiveStatus}`}>{statusLabel(effectiveStatus)}</span>
        </div>

        <section className="loan-metrics" aria-label="Resumen financiero">
          <Metric label="Valor actual" value={formatMoney(loan.currency, valuation.value)} primary />
          <Metric label="Aportes netos" value={formatMoney(loan.currency, valuation.netCashFlow)} />
          <Metric label="Intereses generados" value={formatMoney(loan.currency, valuation.totalInterestGenerated)} />
          <Metric label="Proyección al vencimiento" value={formatMoney(loan.currency, projection.projectedMaturityValue)}>
            <p className="loan-projection-note">Sin considerar futuros ingresos o retiros.</p>
          </Metric>
        </section>

        <div className="loan-detail-layout">
          <section className="loan-detail-section" aria-labelledby="conditions-heading">
            <div className="loan-detail-section__heading">
              <h2 id="conditions-heading">Condiciones</h2>
              {canManageMovements && (
                <button
                  type="button"
                  className="loan-button loan-button--secondary loan-button--compact"
                  onClick={() => setShowTermsDialog(true)}
                >
                  Editar condiciones
                </button>
              )}
            </div>
            <dl className="loan-conditions">
              <div className="loan-condition">
                <dt>Tasa</dt>
                <dd>{formatRatePercent(loan.rate)} · {rateTypeLabel(loan.rateType)}</dd>
              </div>
              <div className="loan-condition">
                <dt>Inicio</dt>
                <dd>{formatDateOnly(loan.startDate)}</dd>
              </div>
              <div className="loan-condition">
                <dt>Vencimiento</dt>
                <dd>{formatDateOnly(loan.maturityDate)}</dd>
              </div>
              <div className="loan-condition">
                <dt>Próxima capitalización</dt>
                <dd>{formatDateOnly(valuation.nextCapitalizationDate)}</dd>
              </div>
              <div className="loan-condition">
                <dt>Estado</dt>
                <dd>{statusLabel(effectiveStatus)}</dd>
              </div>
              <div className="loan-condition">
                <dt>Valuado al</dt>
                <dd>{formatDateOnly(asOfDate)}</dd>
              </div>
            </dl>
          </section>

          <section className="loan-detail-section" aria-labelledby="movements-heading">
            <div className="loan-detail-section__heading">
              <h2 id="movements-heading">Movimientos</h2>
              {canManageMovements && (
                <button
                  type="button"
                  className="loan-button loan-button--primary loan-button--compact"
                  onClick={() => setMovementDialog({ movement: null })}
                >
                  + Movimiento
                </button>
              )}
            </div>
            {visibleMovements.length === 0 ? (
              <p className="loan-projection-note">No hay movimientos registrados.</p>
            ) : (
              <div className="loan-movements">
                {visibleMovements.map((movement, index) => (
                  <MovementRow
                    key={movement.id || `${movement.effectiveDate}-${index}`}
                    movement={movement}
                    currency={loan.currency}
                    onEdit={canManageMovements ? (selected) => setMovementDialog({ movement: selected }) : null}
                    onDelete={canManageMovements ? (selected) => setDeleteDialog({ movement: selected }) : null}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </>
    );
  }

  return (
    <div className="loan-page">
      <main className="loan-page__inner">
        <header className="loan-page__header">
          <Link className="loan-back-link" to="/activos" aria-label="Volver a Activos">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <div className="loan-page__header-actions">
            <LogoutButton />
          </div>
        </header>
        {content}
      </main>
      {movementDialog && presentation && (
        <LoanMovementForm
          key={movementDialog.movement?.id || 'new-movement'}
          uid={uid}
          loanId={loanId}
          loan={presentation.loan}
          movement={movementDialog.movement}
          repository={repository}
          onCancel={() => setMovementDialog(null)}
          onSaved={changesSaved}
        />
      )}
      {deleteDialog && presentation && (
        <LoanMovementDeleteDialog
          uid={uid}
          loanId={loanId}
          loan={presentation.loan}
          movement={deleteDialog.movement}
          repository={repository}
          onCancel={() => setDeleteDialog(null)}
          onDeleted={changesSaved}
        />
      )}
      {showTermsDialog && presentation && (
        <LoanTermsForm
          uid={uid}
          loanId={loanId}
          loan={presentation.loan}
          asOfDate={asOfDate}
          repository={repository}
          onCancel={() => setShowTermsDialog(false)}
          onSaved={changesSaved}
        />
      )}
      <AppBottomNav hidden={bottomNavHidden} />
    </div>
  );
}
