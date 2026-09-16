import { useRef, useState } from 'react';
import {
  LoanFormValidationError,
  formatDateOnly,
  formatMoney,
  movementDeleteErrorMessage,
  movementTypeLabel,
  submitLoanMovementDeletion,
} from './loanUi';

export default function LoanMovementDeleteDialog({
  uid,
  loanId,
  loan,
  movement,
  repository,
  onCancel,
  onDeleted,
}) {
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);

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
        className="loan-dialog loan-dialog--movement"
        role="dialog"
        aria-modal="true"
        aria-labelledby="loan-delete-title"
        aria-describedby="loan-delete-description"
      >
        <div className="loan-dialog__handle" aria-hidden="true" />
        <div className="loan-dialog__header">
          <div>
            <p className="loan-kicker">Movimientos</p>
            <h2 id="loan-delete-title">Eliminar movimiento</h2>
          </div>
          <button type="button" className="loan-icon-button" onClick={onCancel} aria-label="Cerrar confirmación" disabled={saving}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form className="loan-form" onSubmit={handleSubmit} noValidate>
          <div className="loan-delete-summary loan-field--wide">
            <div><span>Tipo</span><strong>{movementTypeLabel(movement.type)}</strong></div>
            <div><span>Fecha</span><strong>{formatDateOnly(movement.effectiveDate)}</strong></div>
            <div><span>Importe</span><strong>{formatMoney(loan.currency, movement.amount)}</strong></div>
          </div>
          <p id="loan-delete-description" className="loan-form__audit-note loan-field--wide">
            El movimiento dejará de afectar el préstamo. Se conservará internamente el registro de auditoría.
          </p>
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
