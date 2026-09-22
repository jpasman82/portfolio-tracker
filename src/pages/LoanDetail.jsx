import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { db } from '../firebase/config';
import AppBottomNav from '../components/AppBottomNav';
import LogoutButton from '../components/LogoutButton';
import LoanMovementForm from '../features/loans/LoanMovementForm';
import LoanMovementDeleteDialog from '../features/loans/LoanMovementDeleteDialog';
import LoanFlow from '../features/loans/LoanFlow';
import LoanTermsForm from '../features/loans/LoanTermsForm';
import { createLoanRepository } from '../features/loans/loanRepository';
import {
  formatPercentValue,
  interestSharePercent,
  loanDetailActions,
  loanTermProgress,
  nextCapitalizationPreview,
} from '../features/loans/loanPresentation';
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

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Start → today → maturity, with the elapsed share of the term. */
function TermBar({ term, loan }) {
  const marker = Math.min(99, Math.max(1, term.percent));
  return (
    <section className="loan-term" aria-label="Vigencia del préstamo">
      <div className="loan-term__track">
        <div className="loan-term__fill" style={{ width: `${term.percent}%` }} />
        {term.phase === 'active' && (
          <div className="loan-term__marker" style={{ left: `${marker}%` }} />
        )}
      </div>
      <div className="loan-term__labels">
        <span>{formatDateOnly(loan.startDate)} inicio</span>
        <span className={`loan-term__now loan-term__now--${term.phase}`}>
          {term.phase === 'pending'
            ? 'Aún no comenzó'
            : term.phase === 'matured'
              ? 'Plazo cumplido'
              : `Hoy · ${term.elapsedDays} de ${term.totalDays} días`}
        </span>
        <span>{formatDateOnly(loan.maturityDate)} vence</span>
      </div>
    </section>
  );
}

function MovementRow({ movement, currency, onEdit }) {
  const withdrawal = movement.type === 'withdrawal';
  return (
    <div className={`loan-movement${withdrawal ? ' loan-movement--withdrawal' : ''}`}>
      <span className="loan-movement__icon" aria-hidden="true">{withdrawal ? '▼' : '▲'}</span>
      <div className="loan-movement__body">
        <p className="loan-movement__type">
          {movementTypeLabel(movement.type)}
          <span className="loan-movement__date"> · {formatDateOnly(movement.effectiveDate)}</span>
        </p>
        {movement.note && <p className="loan-movement__note">{movement.note}</p>}
      </div>
      <p className="loan-movement__amount">
        {withdrawal ? '−' : '+'} {formatMoney(currency, movement.amount)}
      </p>
      {onEdit && (
        <button
          type="button"
          className="loan-movement__edit"
          onClick={() => onEdit(movement)}
        >
          Editar
          <span className="loan-visually-hidden">
            {` ${movementTypeLabel(movement.type)} del ${formatDateOnly(movement.effectiveDate)}`}
          </span>
        </button>
      )}
    </div>
  );
}

function Term({ label, children }) {
  return (
    <div className="loan-term-item">
      <dt>{label}</dt>
      <dd>{children}</dd>
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
  const [termsDialog, setTermsDialog] = useState(null);
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
    setTermsDialog(null);
    retry();
  };

  const { canManage, pastMaturity, primaryAction } = loanDetailActions({
    loan: presentation?.loan,
    effectiveStatus: presentation?.effectiveStatus,
  });
  const openTerms = (mode) => setTermsDialog({ mode });

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
    const {
      loan,
      valuation,
      projection,
      timeline,
      visibleMovements,
      effectiveStatus,
    } = presentation;
    const term = loanTermProgress({ loan, asOfDate });
    const share = interestSharePercent(valuation);
    const nextCapitalization = nextCapitalizationPreview({ timeline, valuation, asOfDate });

    content = (
      <>
        <div className="loan-identity">
          <div className="loan-identity__name-line">
            <h1>{loan.name}</h1>
            <span className={`loan-badge loan-badge--${effectiveStatus}`}>
              {statusLabel(effectiveStatus)}
            </span>
          </div>
          <p className="loan-identity__meta">
            Préstamo · {loan.currency} · {formatRatePercent(loan.rate)} {rateTypeLabel(loan.rateType).toLowerCase()}
          </p>
        </div>

        <div className="loan-headline">
          <section className="loan-lead" aria-label="Valor actual">
            <p className="loan-lead__label">Valor actual · {formatDateOnly(asOfDate)}</p>
            <p className="loan-lead__value">{formatMoney(loan.currency, valuation.value)}</p>
            <p className="loan-lead__delta">
              + {formatMoney(loan.currency, valuation.totalInterestGenerated)}
              <span className="loan-lead__delta-context">
                {` de intereses sobre ${formatMoney(loan.currency, valuation.netCashFlow)} aportados`}
                {share !== null ? ` · ${formatPercentValue(share)}` : ''}
              </span>
            </p>
            <TermBar term={term} loan={loan} />
            {pastMaturity && canManage && (
              <p className="loan-note loan-note--matured" role="status">
                El préstamo venció y dejó de devengar interés. Ampliá el vencimiento para continuarlo.
              </p>
            )}
          </section>

          <section className="loan-secondary" aria-label="Proyección al vencimiento">
            <div className="loan-secondary__head">
              <p className="loan-lead__label">Proyección al vencimiento</p>
              <span className="loan-secondary__date">{formatDateOnly(loan.maturityDate)}</span>
            </div>
            <p className="loan-secondary__value">
              {formatMoney(loan.currency, projection.projectedMaturityValue)}
            </p>
            <p className="loan-secondary__note">
              {pastMaturity
                ? 'El plazo se cumplió: el valor ya no cambia mientras el vencimiento siga vigente.'
                : `${formatMoney(loan.currency, projection.projectedFutureInterest)} de interés futuro estimado, sin nuevos ingresos ni retiros.`}
            </p>
          </section>
        </div>

        <div className="loan-detail-layout">
          <section className="loan-block" aria-labelledby="conditions-heading">
            <div className="loan-block__heading">
              <h2 id="conditions-heading">Condiciones</h2>
              {canManage && (
                <button
                  type="button"
                  className="loan-link-button"
                  onClick={() => openTerms('correction')}
                >
                  <EditIcon />
                  Editar
                  <span className="loan-visually-hidden"> condiciones del préstamo</span>
                </button>
              )}
            </div>
            <dl className="loan-terms-grid">
              <Term label="Tasa">{formatRatePercent(loan.rate)} · {rateTypeLabel(loan.rateType)}</Term>
              <Term label="Capitalización">Mensual</Term>
              <Term label="Inicio">{formatDateOnly(loan.startDate)}</Term>
              <Term label="Vencimiento">{formatDateOnly(loan.maturityDate)}</Term>
              <Term label="Moneda">{loan.currency} · no editable</Term>
              {nextCapitalization && (
                <>
                  <Term label="Próxima capitalización">
                    {formatDateOnly(nextCapitalization.date)}
                  </Term>
                  <Term
                    label={nextCapitalization.daysAway > 0
                      ? `En ${nextCapitalization.daysAway} días suma`
                      : 'Suma estimada'}
                  >
                    {formatMoney(loan.currency, nextCapitalization.amount)}
                  </Term>
                </>
              )}
            </dl>
            <p className="loan-note">
              Cada corrección queda registrada con su motivo y muestra el antes y el después antes de confirmarse.
            </p>
          </section>

          <section className="loan-block" aria-labelledby="movements-heading">
            <div className="loan-block__heading">
              <h2 id="movements-heading">Movimientos</h2>
              <span className="loan-block__meta">
                {visibleMovements.length} · neto {formatMoney(loan.currency, valuation.netCashFlow)}
              </span>
            </div>
            {visibleMovements.length === 0 ? (
              <p className="loan-note">No hay movimientos registrados.</p>
            ) : (
              <div className="loan-movements">
                {visibleMovements.map((movement, index) => (
                  <MovementRow
                    key={movement.id || `${movement.effectiveDate}-${index}`}
                    movement={movement}
                    currency={loan.currency}
                    onEdit={canManage ? (selected) => setMovementDialog({ movement: selected }) : null}
                  />
                ))}
              </div>
            )}
            <p className="loan-note">
              Eliminar un movimiento se hace desde su ficha de edición. El tipo se distingue por la palabra, el signo y la flecha, no sólo por el color.
            </p>
          </section>
        </div>

        <LoanFlow loan={loan} timeline={timeline} asOfDate={asOfDate} />
      </>
    );
  }

  return (
    <div className={`loan-page${canManage ? ' loan-page--with-action-bar' : ''}`}>
      <main className="loan-page__inner">
        <header className="loan-page__header">
          <Link className="loan-back-link" to="/activos">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
            <span className="loan-back-link__text">Activos · Préstamos</span>
            <span className="loan-visually-hidden">Volver a Activos</span>
          </Link>
          <div className="loan-page__header-actions">
            {canManage && (
              <>
                <button
                  type="button"
                  className="loan-button loan-button--secondary loan-button--compact loan-action--desktop"
                  onClick={() => openTerms('correction')}
                >
                  <EditIcon />
                  Editar condiciones
                </button>
                {primaryAction === 'movement' ? (
                  <button
                    type="button"
                    className="loan-button loan-button--primary loan-button--compact loan-action--desktop"
                    onClick={() => setMovementDialog({ movement: null })}
                  >
                    <PlusIcon />
                    Movimiento
                  </button>
                ) : (
                  <button
                    type="button"
                    className="loan-button loan-button--primary loan-button--compact loan-action--desktop"
                    onClick={() => openTerms('maturity_extension')}
                  >
                    Ampliar vencimiento
                  </button>
                )}
              </>
            )}
            <LogoutButton />
          </div>
        </header>
        {content}
      </main>

      {canManage && !movementDialog && !deleteDialog && !termsDialog && (
        <div className="loan-action-bar loan-action--mobile">
          {primaryAction === 'movement' ? (
            <button
              type="button"
              className="loan-button loan-button--primary loan-button--block"
              onClick={() => setMovementDialog({ movement: null })}
            >
              <PlusIcon />
              Movimiento
            </button>
          ) : (
            <button
              type="button"
              className="loan-button loan-button--primary loan-button--block"
              onClick={() => openTerms('maturity_extension')}
            >
              Ampliar vencimiento
            </button>
          )}
          <button
            type="button"
            className="loan-button loan-button--secondary loan-button--icon"
            onClick={() => openTerms('correction')}
            aria-label="Editar condiciones del préstamo"
          >
            <EditIcon />
          </button>
        </div>
      )}

      {movementDialog && presentation && (
        <LoanMovementForm
          key={movementDialog.movement?.id || 'new-movement'}
          uid={uid}
          loanId={loanId}
          loan={presentation.loan}
          movements={presentation.movements}
          asOfDate={asOfDate}
          movement={movementDialog.movement}
          repository={repository}
          onCancel={() => setMovementDialog(null)}
          onDelete={(movement) => {
            setMovementDialog(null);
            setDeleteDialog({ movement });
          }}
          onSaved={changesSaved}
        />
      )}
      {deleteDialog && presentation && (
        <LoanMovementDeleteDialog
          uid={uid}
          loanId={loanId}
          loan={presentation.loan}
          movements={presentation.movements}
          asOfDate={asOfDate}
          movement={deleteDialog.movement}
          currentValue={presentation.valuation.value}
          repository={repository}
          onCancel={() => setDeleteDialog(null)}
          onDeleted={changesSaved}
        />
      )}
      {termsDialog && presentation && (
        <LoanTermsForm
          uid={uid}
          loanId={loanId}
          loan={presentation.loan}
          asOfDate={asOfDate}
          repository={repository}
          initialMode={termsDialog.mode}
          onCancel={() => setTermsDialog(null)}
          onSaved={changesSaved}
        />
      )}
      <AppBottomNav hidden={bottomNavHidden} />
    </div>
  );
}
