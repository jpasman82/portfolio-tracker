import { useRef, useState } from 'react';
import {
  LoanFormValidationError,
  buildLoanTermsChangeInput,
  formatDateOnly,
  formatMoney,
  formatRatePercent,
  loanTermsErrorMessage,
  loanTermsFormValues,
  rateTypeLabel,
} from './loanUi';

const TERM_LABELS = Object.freeze({
  name: 'Nombre',
  startDate: 'Fecha inicial',
  maturityDate: 'Vencimiento',
  rate: 'Tasa',
  rateType: 'Tipo de tasa',
});

function formattedTerm(field, value) {
  if (field === 'startDate' || field === 'maturityDate') return formatDateOnly(value);
  if (field === 'rate') return formatRatePercent(value);
  if (field === 'rateType') return rateTypeLabel(value);
  return value;
}

export default function LoanTermsForm({
  uid,
  loanId,
  loan,
  asOfDate,
  repository,
  onCancel,
  onSaved,
}) {
  const [mode, setMode] = useState('correction');
  const [form, setForm] = useState(() => loanTermsFormValues(loan));
  const [preview, setPreview] = useState(null);
  const [fieldError, setFieldError] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const operationInFlight = useRef(false);

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setPreview(null);
    if (fieldError === name) setFieldError('');
    setErrorMessage('');
  };

  const chooseMode = (nextMode) => {
    setMode(nextMode);
    setPreview(null);
    setFieldError('');
    setErrorMessage('');
  };

  const beginOperation = () => {
    if (operationInFlight.current) return false;
    operationInFlight.current = true;
    setLoading(true);
    setFieldError('');
    setErrorMessage('');
    return true;
  };

  const finishWithError = (error) => {
    if (error instanceof LoanFormValidationError) setFieldError(error.field);
    else console.error('Error changing loan terms', error);
    setErrorMessage(loanTermsErrorMessage(error));
    operationInFlight.current = false;
    setLoading(false);
  };

  const handlePreview = async (event) => {
    event.preventDefault();
    if (!beginOperation()) return;
    try {
      const input = buildLoanTermsChangeInput({ loan, mode, form, asOfDate });
      const result = await repository.previewLoanTermsChange(uid, loanId, input);
      setPreview({ ...result, input });
      operationInFlight.current = false;
      setLoading(false);
    } catch (error) {
      finishWithError(error);
    }
  };

  const handleApply = async () => {
    if (!preview || !beginOperation()) return;
    try {
      const result = await repository.applyLoanTermsChange(uid, loanId, {
        ...preview.input,
        expectedRevision: preview.revision,
      });
      onSaved(result);
    } catch (error) {
      finishWithError(error);
    }
  };

  const changedFields = preview
    ? Object.keys(preview.input.changes).filter(
      (field) => preview.currentTerms[field] !== preview.proposedTerms[field],
    )
    : [];

  return (
    <div className="loan-dialog-backdrop" role="presentation">
      <section
        className="loan-dialog loan-dialog--terms"
        role="dialog"
        aria-modal="true"
        aria-labelledby="loan-terms-title"
        aria-describedby={errorMessage ? 'loan-terms-error' : undefined}
      >
        <div className="loan-dialog__handle" aria-hidden="true" />
        <div className="loan-dialog__header">
          <div>
            <p className="loan-kicker">Condiciones</p>
            <h2 id="loan-terms-title">Editar condiciones</h2>
          </div>
          <button type="button" className="loan-icon-button" onClick={onCancel} aria-label="Cerrar formulario" disabled={loading}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!preview ? (
          <form className="loan-form" onSubmit={handlePreview} noValidate>
            <div className="loan-mode-selector loan-field--wide" role="group" aria-label="Tipo de cambio">
              <button type="button" className={mode === 'correction' ? 'is-active' : ''} onClick={() => chooseMode('correction')}>
                Corregir datos
              </button>
              <button type="button" className={mode === 'maturity_extension' ? 'is-active' : ''} onClick={() => chooseMode('maturity_extension')}>
                Ampliar vencimiento
              </button>
            </div>

            {mode === 'correction' ? (
              <>
                <label className="loan-field loan-field--wide">
                  <span>Nombre</span>
                  <input name="name" value={form.name} onChange={updateField} maxLength="120" aria-invalid={fieldError === 'name'} />
                </label>
                <label className="loan-field">
                  <span>Moneda</span>
                  <input value={loan.currency} disabled aria-label="Moneda inmutable" />
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
                  <input type="date" name="startDate" value={form.startDate} onChange={updateField} aria-invalid={fieldError === 'startDate'} />
                </label>
                <label className="loan-field">
                  <span>Vencimiento</span>
                  <input type="date" name="maturityDate" value={form.maturityDate} min={form.startDate} onChange={updateField} aria-invalid={fieldError === 'maturityDate'} />
                </label>
                <label className="loan-field loan-field--wide">
                  <span>Tasa (%)</span>
                  <div className="loan-field__suffix">
                    <input name="rate" value={form.rate} onChange={updateField} inputMode="decimal" aria-invalid={fieldError === 'rate'} />
                    <span>%</span>
                  </div>
                </label>
              </>
            ) : (
              <>
                <div className="loan-field">
                  <span>Vencimiento actual</span>
                  <strong>{formatDateOnly(loan.maturityDate)}</strong>
                </div>
                <label className="loan-field">
                  <span>Nuevo vencimiento</span>
                  <input
                    type="date"
                    name="newMaturityDate"
                    value={form.newMaturityDate}
                    min={loan.maturityDate}
                    onChange={updateField}
                    aria-invalid={fieldError === 'newMaturityDate'}
                  />
                </label>
              </>
            )}

            <label className="loan-field loan-field--wide">
              <span>Motivo</span>
              <textarea
                name="reason"
                value={form.reason}
                onChange={updateField}
                maxLength="1000"
                rows="3"
                placeholder="Explicá por qué se modifica el contrato"
                aria-invalid={fieldError === 'reason'}
              />
            </label>

            {errorMessage ? <div id="loan-terms-error" className="loan-error" role="alert">{errorMessage}</div> : null}

            <div className="loan-dialog__actions">
              <button type="button" className="loan-button loan-button--secondary" onClick={onCancel} disabled={loading}>Cancelar</button>
              <button type="submit" className="loan-button loan-button--primary" disabled={loading}>
                {loading ? 'Calculando…' : 'Ver antes y después'}
              </button>
            </div>
          </form>
        ) : (
          <div className="loan-terms-preview">
            <div className="loan-terms-preview__changes">
              {changedFields.map((field) => (
                <div className="loan-terms-change" key={field}>
                  <span>{TERM_LABELS[field]}</span>
                  <p><del>{formattedTerm(field, preview.currentTerms[field])}</del></p>
                  <p><strong>{formattedTerm(field, preview.proposedTerms[field])}</strong></p>
                </div>
              ))}
            </div>
            <div className="loan-before-after">
              <article>
                <span>ANTES</span>
                <p>Valor actual <strong>{formatMoney(loan.currency, preview.currentValue.value)}</strong></p>
                <p>Proyección <strong>{formatMoney(loan.currency, preview.currentProjection.projectedMaturityValue)}</strong></p>
              </article>
              <article>
                <span>DESPUÉS</span>
                <p>Valor actual <strong>{formatMoney(loan.currency, preview.proposedValue.value)}</strong></p>
                <p>Proyección <strong>{formatMoney(loan.currency, preview.proposedProjection.projectedMaturityValue)}</strong></p>
              </article>
            </div>
            {preview.continuesAccrualAfterOriginalMaturity ? (
              <div className="loan-warning" role="status">
                El préstamo ya había vencido. La ampliación continúa el devengamiento con la misma tasa desde el vencimiento original.
              </div>
            ) : null}
            {errorMessage ? <div id="loan-terms-error" className="loan-error" role="alert">{errorMessage}</div> : null}
            <div className="loan-dialog__actions">
              <button type="button" className="loan-button loan-button--secondary" onClick={() => setPreview(null)} disabled={loading}>Volver</button>
              <button type="button" className="loan-button loan-button--primary" onClick={handleApply} disabled={loading}>
                {loading ? 'Guardando…' : 'Confirmar cambio'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
