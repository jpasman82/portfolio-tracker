import { useState } from 'react';
import { LoanFormValidationError, submitLoanCreation, todayDateOnly } from './loanUi';

const INITIAL_FORM = Object.freeze({
  name: '',
  currency: 'USD',
  startDate: '',
  maturityDate: '',
  rateType: 'monthly_effective',
  rate: '',
  initialAmount: '',
});

function userFacingSaveError(error) {
  if (error instanceof LoanFormValidationError) return error.message;
  return 'No pudimos guardar el préstamo. Revisá los datos e intentá nuevamente.';
}

export default function NewLoanForm({ uid, repository, onCancel, onCreated }) {
  const [form, setForm] = useState(() => ({ ...INITIAL_FORM, startDate: todayDateOnly() }));
  const [fieldError, setFieldError] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    if (fieldError === name) setFieldError('');
    setErrorMessage('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFieldError('');
    setErrorMessage('');

    try {
      const created = await submitLoanCreation({ uid, form, repository });
      onCreated(created);
    } catch (error) {
      if (error instanceof LoanFormValidationError) {
        setFieldError(error.field);
      } else {
        console.error('Error creating loan', error);
      }
      setErrorMessage(userFacingSaveError(error));
      setSaving(false);
    }
  };

  const describedBy = errorMessage ? 'new-loan-error' : undefined;

  return (
    <div className="loan-dialog-backdrop" role="presentation">
      <section
        className="loan-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-loan-title"
        aria-describedby={describedBy}
      >
        <div className="loan-dialog__handle" aria-hidden="true" />
        <div className="loan-dialog__header">
          <div>
            <p className="loan-kicker">Préstamos</p>
            <h2 id="new-loan-title">Nuevo préstamo</h2>
          </div>
          <button type="button" className="loan-icon-button" onClick={onCancel} aria-label="Cerrar formulario" disabled={saving}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form className="loan-form" onSubmit={handleSubmit} noValidate>
          <label className="loan-field loan-field--wide">
            <span>Nombre</span>
            <input
              name="name"
              value={form.name}
              onChange={updateField}
              autoComplete="off"
              maxLength="120"
              placeholder="Ej. Préstamo privado"
              aria-invalid={fieldError === 'name'}
            />
          </label>

          <label className="loan-field">
            <span>Moneda</span>
            <select name="currency" value={form.currency} onChange={updateField} aria-invalid={fieldError === 'currency'}>
              <option value="USD">USD</option>
              <option value="ARS">ARS</option>
            </select>
          </label>

          <label className="loan-field">
            <span>Tipo de tasa</span>
            <select name="rateType" value={form.rateType} onChange={updateField} aria-invalid={fieldError === 'rateType'}>
              <option value="monthly_effective">Mensual</option>
              <option value="annual_effective">Anual efectiva</option>
            </select>
          </label>

          <label className="loan-field">
            <span>Fecha inicial</span>
            <input
              type="date"
              name="startDate"
              value={form.startDate}
              onChange={updateField}
              aria-invalid={fieldError === 'startDate'}
            />
          </label>

          <label className="loan-field">
            <span>Vencimiento</span>
            <input
              type="date"
              name="maturityDate"
              value={form.maturityDate}
              min={form.startDate || undefined}
              onChange={updateField}
              aria-invalid={fieldError === 'maturityDate'}
            />
          </label>

          <label className="loan-field">
            <span>Tasa (%)</span>
            <div className="loan-field__suffix">
              <input
                name="rate"
                value={form.rate}
                onChange={updateField}
                inputMode="decimal"
                autoComplete="off"
                placeholder="1,25"
                aria-invalid={fieldError === 'rate'}
              />
              <span>%</span>
            </div>
            <small>Ingresala como porcentaje, por ejemplo 1,25.</small>
          </label>

          <label className="loan-field">
            <span>Monto inicial</span>
            <div className="loan-field__prefix">
              <span>{form.currency}</span>
              <input
                name="initialAmount"
                value={form.initialAmount}
                onChange={updateField}
                inputMode="decimal"
                autoComplete="off"
                placeholder="710.000"
                aria-invalid={fieldError === 'initialAmount'}
              />
            </div>
            <small>Se registrará como el primer ingreso.</small>
          </label>

          {errorMessage && (
            <div id="new-loan-error" className="loan-error" role="alert">
              {errorMessage}
            </div>
          )}

          <div className="loan-dialog__actions">
            <button type="button" className="loan-button loan-button--secondary" onClick={onCancel} disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="loan-button loan-button--primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar préstamo'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
