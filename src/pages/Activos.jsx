import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../firebase/config';
import AppBottomNav from '../components/AppBottomNav';
import LogoutButton from '../components/LogoutButton';
import NewLoanForm from '../features/loans/NewLoanForm';
import { createLoanRepository } from '../features/loans/loanRepository';
import {
  formatPercentValue,
  interestSharePercent,
  loanCurrencyTotals,
  loanTermProgress,
} from '../features/loans/loanPresentation';
import {
  formatDateOnly,
  formatMoney,
  formatRatePercent,
  loadLoanCards,
  rateTypeLabel,
  statusLabel,
  todayDateOnly,
} from '../features/loans/loanUi';
import './Activos.css';

const loanRepository = createLoanRepository(db);

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function LoanRow({ presentation, asOfDate }) {
  const { loan, valuation, projection, effectiveStatus } = presentation;
  const share = interestSharePercent(valuation);
  const term = loanTermProgress({ loan, asOfDate });
  const matured = term.phase === 'matured';

  return (
    <Link className="loan-row" to={`/activos/prestamos/${loan.id}`}>
      <span className="loan-row__identity">
        <span className="loan-row__name-line">
          <span className="loan-row__name">{loan.name}</span>
          <span className={`loan-badge loan-badge--${effectiveStatus}`}>
            {statusLabel(effectiveStatus)}
          </span>
        </span>
        <span className="loan-row__meta">
          {loan.currency} · {formatRatePercent(loan.rate)} {rateTypeLabel(loan.rateType).toLowerCase()}
          {' · inicio '}
          {formatDateOnly(loan.startDate)}
        </span>
      </span>

      <span className="loan-row__cell loan-row__cell--value">
        <span className="loan-row__cell-label">Valor actual</span>
        <span className="loan-row__value">{formatMoney(loan.currency, valuation.value)}</span>
      </span>

      <span className="loan-row__cell loan-row__cell--interest">
        <span className="loan-row__cell-label">Intereses</span>
        <span className="loan-row__interest">
          + {formatMoney(loan.currency, valuation.totalInterestGenerated)}
        </span>
        {share !== null && (
          <span className="loan-row__sub">{formatPercentValue(share)} sobre aportes</span>
        )}
      </span>

      <span className="loan-row__cell loan-row__cell--projection">
        <span className="loan-row__cell-label">Proyección · vence</span>
        <span className="loan-row__projection">
          {formatMoney(loan.currency, projection.projectedMaturityValue)}
        </span>
        <span className="loan-row__sub">
          {matured
            ? `venció ${formatDateOnly(loan.maturityDate)}`
            : `${formatDateOnly(loan.maturityDate)} · ${term.remainingDays} días`}
        </span>
      </span>

      <span className="loan-row__chevron" aria-hidden="true">→</span>
    </Link>
  );
}

export default function Activos({ currentUser }) {
  const uid = currentUser?.uid;
  const navigate = useNavigate();
  const [asOfDate] = useState(() => todayDateOnly());
  const [presentations, setPresentations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showNewLoan, setShowNewLoan] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    if (!uid) return () => { active = false; };

    loadLoanCards({ uid, repository: loanRepository, asOfDate })
      .then((items) => {
        if (!active) return;
        setPresentations(items);
        setError(false);
        setLoading(false);
      })
      .catch((loadError) => {
        console.error('Error loading loans', loadError);
        if (!active) return;
        setError(true);
        setLoading(false);
      });

    return () => { active = false; };
  }, [uid, asOfDate, reloadKey]);

  const retry = () => {
    setLoading(true);
    setError(false);
    setReloadKey((value) => value + 1);
  };

  const totals = useMemo(() => loanCurrencyTotals(presentations), [presentations]);
  const activeCount = useMemo(
    () => presentations.filter((item) => item.effectiveStatus === 'active').length,
    [presentations],
  );
  const hasLoans = presentations.length > 0;

  return (
    <div className="loan-page">
      <main className="loan-page__inner">
        <header className="loan-page__header">
          <div>
            <p className="loan-page__brand">Portfolio Manager</p>
            <h1 className="loan-page__title">Activos</h1>
          </div>
          <div className="loan-page__header-actions">
            <button
              type="button"
              className="loan-button loan-button--primary loan-action--desktop"
              onClick={() => setShowNewLoan(true)}
            >
              <PlusIcon />
              Nuevo préstamo
            </button>
            <LogoutButton />
          </div>
        </header>

        {hasLoans && (
          <section className="loan-totals" aria-label="Total en préstamos">
            <p className="loan-totals__label">Total en préstamos</p>
            <div className="loan-totals__figures">
              {totals.map((total, index) => (
                <p
                  key={total.currency}
                  className={`loan-totals__figure${index === 0 ? ' loan-totals__figure--lead' : ''}`}
                >
                  {formatMoney(total.currency, total.value)}
                </p>
              ))}
            </div>
            <p className="loan-totals__note">
              Seguimiento complementario por fuera de tus brokers. Cada moneda se informa por separado, sin conversión: estos valores no modifican el patrimonio principal ni la Cartera Unificada.
            </p>
          </section>
        )}

        <section aria-labelledby="loans-heading">
          <div className="loan-section__heading">
            <h2 id="loans-heading" className="loan-section__title">Préstamos</h2>
            {hasLoans && (
              <span className="loan-section__count">
                {presentations.length} · {activeCount} activo{activeCount === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {!uid ? (
            <div className="loan-state" role="status">
              <h2>Sesión no disponible</h2>
              <p>Volvé a ingresar para consultar tus préstamos.</p>
            </div>
          ) : loading ? (
            <div className="loan-loading" role="status">
              <span className="loan-spinner" aria-hidden="true" />
              Cargando préstamos
            </div>
          ) : error ? (
            <div className="loan-state" role="alert">
              <h2>No pudimos cargar tus préstamos</h2>
              <p>Revisá tu conexión e intentá nuevamente.</p>
              <button type="button" className="loan-button loan-button--secondary" onClick={retry}>Reintentar</button>
            </div>
          ) : !hasLoans ? (
            <div className="loan-empty">
              <div className="loan-empty__icon" aria-hidden="true">
                <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="M7 9h10M7 13h6" />
                </svg>
              </div>
              <h3>Todavía no hay préstamos</h3>
              <p>Creá el primero para seguir su valor, intereses y proyección de vencimiento.</p>
              <button type="button" className="loan-button loan-button--primary" onClick={() => setShowNewLoan(true)}>
                Nuevo préstamo
              </button>
            </div>
          ) : (
            <div className="loan-list">
              <div className="loan-list__head" aria-hidden="true">
                <span>Préstamo</span>
                <span>Valor actual</span>
                <span>Intereses</span>
                <span>Proyección · vence</span>
                <span />
              </div>
              {presentations.map((item) => (
                <LoanRow key={item.loan.id} presentation={item} asOfDate={asOfDate} />
              ))}
            </div>
          )}
        </section>
      </main>

      {hasLoans && !showNewLoan && (
        <div className="loan-action-bar loan-action--mobile">
          <button
            type="button"
            className="loan-button loan-button--primary loan-button--block"
            onClick={() => setShowNewLoan(true)}
          >
            <PlusIcon />
            Nuevo préstamo
          </button>
        </div>
      )}

      {showNewLoan && (
        <NewLoanForm
          uid={uid}
          repository={loanRepository}
          onCancel={() => setShowNewLoan(false)}
          onCreated={({ assetId }) => navigate(`/activos/prestamos/${assetId}`)}
        />
      )}

      <AppBottomNav />
    </div>
  );
}
