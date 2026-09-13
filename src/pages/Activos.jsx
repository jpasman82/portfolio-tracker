import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../firebase/config';
import AppBottomNav from '../components/AppBottomNav';
import LogoutButton from '../components/LogoutButton';
import NewLoanForm from '../features/loans/NewLoanForm';
import { createLoanRepository } from '../features/loans/loanRepository';
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

function LoanCard({ presentation }) {
  const { loan, valuation, projection, effectiveStatus } = presentation;

  return (
    <Link className="loan-card" to={`/activos/prestamos/${loan.id}`}>
      <div className="loan-card__top">
        <h3 className="loan-card__name">{loan.name}</h3>
        <span className={`loan-badge loan-badge--${effectiveStatus}`}>{statusLabel(effectiveStatus)}</span>
      </div>
      <p className="loan-card__value">{formatMoney(loan.currency, valuation.value)}</p>
      <span className="loan-card__label">Valor actual · {loan.currency}</span>
      <p className="loan-card__rate">
        {formatRatePercent(loan.rate)} · {rateTypeLabel(loan.rateType)}
      </p>
      <div className="loan-card__projection">
        <span className="loan-card__label">Proyección al vencimiento</span>
        <strong>{formatMoney(loan.currency, projection.projectedMaturityValue)}</strong>
      </div>
      <div className="loan-card__footer">
        <span>Vence {formatDateOnly(loan.maturityDate)}</span>
        <span aria-hidden="true">→</span>
      </div>
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

  return (
    <div className="loan-page">
      <main className="loan-page__inner">
        <header className="loan-page__header">
          <div>
            <p className="loan-page__brand">Portfolio Manager</p>
            <h1 className="loan-page__title">Activos</h1>
          </div>
          <div className="loan-page__header-actions">
            <LogoutButton />
          </div>
        </header>

        <p className="loan-page__intro">
          Seguimiento complementario de inversiones por fuera de tus brokers. Estos valores no modifican el patrimonio principal ni la Cartera Unificada.
        </p>

        <section aria-labelledby="loans-heading">
          <div className="loan-section__heading">
            <div>
              <p className="loan-kicker">Activos financieros</p>
              <h2 id="loans-heading">Préstamos</h2>
            </div>
            <button type="button" className="loan-button loan-button--primary" onClick={() => setShowNewLoan(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Nuevo préstamo
            </button>
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
          ) : presentations.length === 0 ? (
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
            <div className="loan-grid">
              {presentations.map((item) => <LoanCard key={item.loan.id} presentation={item} />)}
            </div>
          )}
        </section>
      </main>

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
