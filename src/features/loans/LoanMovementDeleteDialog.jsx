import { useMemo, useRef, useState } from 'react';
import {
  LoanFormValidationError,
  formatDateOnly,
  formatMoney,
  movementDeleteErrorMessage,
  movementTypeLabel,
  previewLoanValueAfterMovementDeletion,
  submitLoanMovementDeletion,
} from './loanUi';

export default function LoanMovementDeleteDialog({
  uid,
  loanId,
  loan,
  movements = [],
  asOfDate,
  movement,
  currentValue,
  repository,
  onCancel,
  onDeleted,
}) {
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);

  // Shown only when the ledger can actually be valued without the movement.
  // A rejection here is the same one the save would raise, so the dialog stays
  // quiet and lets the attempt surface the real message.
  const valueAfter = useMemo(() => {
    if (!asOfDate || !movement?.id) return null;
    try {
      return previewLoanValueAfterMovementDeletion({
        loan,
        movements,
        asOfDate,
        movementId: movement.id,
      }).value;
    } catch {
      return null;
    }
  }, [loan, movements, asOfDate, movement]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setFieldError(false);
    setErrorMessage('');
    try {
      const result = await submitLoanMovementDeletion({
        uid,
        loanId,
        movementId: movement.id,
        reason,
        repository,
      });
      onDeleted(result);
    } catch (error) {
      if (error instanceof LoanFormValidationError) setFieldError(error.field === 'reason');
      else console.error('Error deleting loan movement', error);
      setErrorMessage(movementDeleteErrorMessage(error));
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="loan-dialog-backdrop" role="presentation">
      <section
        className="loan-dialog loan-dialog--movement loan-dialog--danger"
        role="dialog"
        aria-modal="true"
        aria-labelledby="loan-delete-title"
        aria-describedby="loan-delete-description"
      >
        <div className="loan-dialog__handle" aria-hidden="true" />
        <div className="loan-dialog__header">
          <div>
            <h2 id="loan-delete-title">Eliminar movimiento</h2>
            <p className="loan-dialog__context">{loan.name}</p>
          </div>
          <button type="button" className="loan-icon-button" onClick={onCancel} aria-label="Cerrar confirmación" disabled={saving}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form className="loan-form" onSubmit={handleSubmit} noValidate>
          <p id="loan-delete-description" className="loan-dialog__lead loan-field--wide">
            El movimiento dejará de afectar el préstamo. El registro interno de auditoría se conservará.
          </p>

          <dl className="loan-summary-list loan-field--wide">
            <div>
              <dt>Movimiento</dt>
              <dd>{movementTypeLabel(movement.type)} · {formatDateOnly(movement.effectiveDate)}</dd>
            </div>
            <div>
              <dt>Importe</dt>
              <dd>{formatMoney(loan.currency, movement.amount)}</dd>
            </div>
            {valueAfter !== null && currentValue !== undefined && (
              <div>
                <dt>Valor actual</dt>
                <dd>
                  <del>{formatMoney(loan.currency, currentValue)}</del>
                  <span aria-hidden="true"> → </span>
                  <strong>{formatMoney(loan.currency, valueAfter)}</strong>
                </dd>
              </div>
            )}
          </dl>

          <label className="loan-field loan-field--wide">
            <span>Motivo</span>
            <textarea
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setFieldError(false);
                setErrorMessage('');
              }}
              maxLength="500"
              rows="3"
              placeholder="Explicá por qué se elimina"
              aria-invalid={fieldError}
            />
          </label>
          {errorMessage ? <div className="loan-error loan-field--wide" role="alert">{errorMessage}</div> : null}
          <div className="loan-dialog__actions">
            <button type="button" className="loan-button loan-button--secondary" onClick={onCancel} disabled={saving}>Cancelar</button>
            <button type="submit" className="loan-button loan-button--danger" disabled={saving}>
              {saving ? 'Eliminando…' : 'Eliminar movimiento'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
