import { useRef, useState } from 'react';
import {
  LoanFormValidationError,
  movementFormValues,
  movementSaveErrorMessage,
  submitLoanMovement,
} from './loanUi';

export default function LoanMovementForm({
  uid,
  loanId,
  loan,
  movement,
  repository,
  onCancel,
  onSaved,
}) {
  const [form, setForm] = useState(() => movementFormValues({ loan, movement }));
  const [fieldError, setFieldError] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const editing = Boolean(movement);

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    if (fieldError === name) setFieldError('');
    setErrorMessage('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setFieldError('');
    setErrorMessage('');

    try {
      const result = await submitLoanMovement({
        uid,
        loanId,
        loan,
        movementId: movement?.id,
        form,
        repository,
      });
      onSaved(result);
    } catch (error) {
      if (error instanceof LoanFormValidationError) {
        setFieldError(error.field);
      } else {
        console.error('Error saving loan movement', error);
      }
      setErrorMessage(movementSaveErrorMessage(error));
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
        aria-labelledby="loan-movement-title"
        aria-describedby={errorMessage ? 'loan-movement-error' : undefined}
      >
        <div className="loan-dialog__handle" aria-hidden="true" />
        <div className="loan-dialog__header">
          <div>
            <p className="loan-kicker">Movimientos</p>
            <h2 id="loan-movement-title">{editing ? 'Editar movimiento' : 'Nuevo movimiento'}</h2>
          </div>
          <button
            type="button"
            className="loan-icon-button"
            onClick={onCancel}
            aria-label="Cerrar formulario"
            disabled={saving}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form className="loan-form" onSubmit={handleSubmit} noValidate>
          <label className="loan-field">
            <span>Tipo</span>
            <select name="type" value={form.type} onChange={updateField} aria-invalid={fieldError === 'type'}>
              <option value="contribution">Ingreso</option>
              <option value="withdrawal">Retiro</option>
            </select>
          </label>

          <label className="loan-field">
            <span>Fecha</span>
            <input
              type="date"
              name="effectiveDate"
              value={form.effectiveDate}
              min={loan.startDate}
              max={loan.maturityDate}
              onChange={updateField}
              aria-invalid={fieldError === 'effectiveDate'}
            />
          </label>

          <label className="loan-field loan-field--wide">
            <span>Importe</span>
            <div className="loan-field__prefix">
              <span>{loan.currency}</span>
              <input
                name="amount"
                value={form.amount}
                onChange={updateField}
                inputMode="decimal"
                autoComplete="off"
                placeholder="100.000"
                aria-invalid={fieldError === 'amount'}
              />
            </div>
          </label>

          <label className="loan-field loan-field--wide">
            <span>Nota opcional</span>
            <input
              name="note"
              value={form.note}
              onChange={updateField}
              autoComplete="off"
              maxLength="500"
              placeholder="Detalle del movimiento"
              aria-invalid={fieldError === 'note'}
            />
          </label>

          {errorMessage && (
            <div id="loan-movement-error" className="loan-error" role="alert">
              {errorMessage}
            </div>
          )}

          {editing && (
            <p className="loan-form__audit-note">
              La corrección conserva el movimiento original en el historial de auditoría.
            </p>
          )}

          <div className="loan-dialog__actions">
            <button type="button" className="loan-button loan-button--secondary" onClick={onCancel} disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="loan-button loan-button--primary" disabled={saving}>
              {saving ? 'Guardando…' : editing ? 'Guardar corrección' : 'Guardar movimiento'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
