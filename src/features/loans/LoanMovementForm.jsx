import { useMemo, useRef, useState } from 'react';
import { movementDateShortcuts } from './loanPresentation';
import {
  LoanFormValidationError,
  formatDateOnly,
  formatMoney,
  movementFormValues,
  movementSaveErrorMessage,
  previewLoanValueAfterMovement,
  submitLoanMovement,
} from './loanUi';

const TYPES = Object.freeze([
  { value: 'contribution', label: 'Ingreso', glyph: '▲' },
  { value: 'withdrawal', label: 'Retiro', glyph: '▼' },
]);

export default function LoanMovementForm({
  uid,
  loanId,
  loan,
  movements = [],
  asOfDate,
  movement,
  repository,
  onCancel,
  onDelete,
  onSaved,
}) {
  const [form, setForm] = useState(() => movementFormValues({ loan, movement }));
  const [fieldError, setFieldError] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const editing = Boolean(movement);

  const shortcuts = useMemo(
    () => (asOfDate ? movementDateShortcuts({ loan, today: asOfDate, movements }) : []),
    [loan, asOfDate, movements],
  );

  // The resulting value is only shown once the form is complete enough for the
  // engine to value it; an incomplete form simply has nothing to preview.
  const resultingValue = useMemo(() => {
    if (!asOfDate) return null;
    try {
      return previewLoanValueAfterMovement({
        loan,
        movements,
        asOfDate,
        movementId: movement?.id,
        form,
      }).value;
    } catch {
      return null;
    }
  }, [loan, movements, asOfDate, movement, form]);

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    if (fieldError === name) setFieldError('');
    setErrorMessage('');
  };

  const chooseType = (type) => {
    setForm((current) => ({ ...current, type }));
    if (fieldError === 'type') setFieldError('');
    setErrorMessage('');
  };

  const chooseDate = (date) => {
    setForm((current) => ({ ...current, effectiveDate: date }));
    if (fieldError === 'effectiveDate') setFieldError('');
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
            <h2 id="loan-movement-title">{editing ? 'Editar movimiento' : 'Nuevo movimiento'}</h2>
            <p className="loan-dialog__context">
              {editing
                ? `${loan.name} · ${formatMoney(loan.currency, movement.amount)} del ${formatDateOnly(movement.effectiveDate)}`
                : `${loan.name} · ${loan.currency} · entre ${formatDateOnly(loan.startDate)} y ${formatDateOnly(loan.maturityDate)}`}
            </p>
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
          <div className="loan-field loan-field--wide">
            <span id="loan-movement-type-label">Tipo</span>
            <div className="loan-toggle" role="group" aria-labelledby="loan-movement-type-label">
              {TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  className={`loan-toggle__option loan-toggle__option--${type.value}`}
                  aria-pressed={form.type === type.value}
                  onClick={() => chooseType(type.value)}
                  disabled={saving}
                >
                  <span aria-hidden="true">{type.glyph}</span>
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          <label className="loan-field loan-field--wide loan-field--amount">
            <span>Importe</span>
            <div className="loan-field__prefix loan-field__prefix--lead">
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

          <div className="loan-field loan-field--wide">
            <label className="loan-field__label" htmlFor="loan-movement-date">Fecha</label>
            <input
              id="loan-movement-date"
              type="date"
              name="effectiveDate"
              value={form.effectiveDate}
              min={loan.startDate}
              max={loan.maturityDate}
              onChange={updateField}
              aria-invalid={fieldError === 'effectiveDate'}
            />
            {shortcuts.length > 0 && (
              <div className="loan-chips">
                {shortcuts.map((shortcut) => (
                  <button
                    key={shortcut.id}
                    type="button"
                    className="loan-chip"
                    aria-pressed={form.effectiveDate === shortcut.date}
                    onClick={() => chooseDate(shortcut.date)}
                    disabled={saving}
                  >
                    {shortcut.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="loan-field loan-field--wide">
            <span>Nota <span className="loan-field__optional">opcional</span></span>
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

          {resultingValue !== null && (
            <div className="loan-outcome loan-field--wide">
              <span>Valor tras el movimiento</span>
              <strong>{formatMoney(loan.currency, resultingValue)}</strong>
            </div>
          )}

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

          {editing && onDelete && (
            <div className="loan-destructive-row loan-field--wide">
              <button
                type="button"
                className="loan-button loan-button--ghost-danger"
                onClick={() => onDelete(movement)}
                disabled={saving}
              >
                Eliminar movimiento
              </button>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
