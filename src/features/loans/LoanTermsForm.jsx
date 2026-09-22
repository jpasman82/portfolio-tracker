import { useRef, useState } from 'react';
import { shiftDateByMonths } from './loanPresentation';
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

const EXTENSION_SHORTCUTS = Object.freeze([3, 6, 12]);

function formattedTerm(field, value) {
  if (field === 'startDate' || field === 'maturityDate') return formatDateOnly(value);
  if (field === 'rate') return formatRatePercent(value);
  if (field === 'rateType') return rateTypeLabel(value);
  return value;
}

/** One before → after pair on a single row, so the comparison never wraps. */
function BeforeAfterRow({ label, before, after, emphasis = false }) {
  return (
    <div className={`loan-pair${emphasis ? ' loan-pair--emphasis' : ''}`}>
      <div className="loan-pair__side">
        <p className="loan-pair__label">{label} antes</p>
        <p className="loan-pair__before">{before}</p>
      </div>
      <span className="loan-pair__arrow" aria-hidden="true">→</span>
      <div className="loan-pair__side">
        <p className="loan-pair__label loan-pair__label--after">Después</p>
        <p className="loan-pair__after">{after}</p>
      </div>
    </div>
  );
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

  // UI-only convenience: it fills the same date input the user could type, and
  // the value still goes through the ordinary extension validation on submit.
  const applyExtensionShortcut = (months) => {
    setForm((current) => ({
      ...current,
      newMaturityDate: shiftDateByMonths(loan.maturityDate, months),
    }));
    setPreview(null);
    if (fieldError === 'newMaturityDate') setFieldError('');
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
  const extending = mode === 'maturity_extension';

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
            <h2 id="loan-terms-title">
              {preview ? 'Antes y después' : extending ? 'Ampliar vencimiento' : 'Corregir datos'}
            </h2>
            <p className="loan-dialog__context">
              {preview
                ? 'Revisá el impacto antes de confirmar · queda registrado con motivo'
                : `${loan.name} · queda registrado con motivo`}
            </p>
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
              <button
                type="button"
                className={mode === 'correction' ? 'is-active' : ''}
                aria-pressed={mode === 'correction'}
                onClick={() => chooseMode('correction')}
              >
                Corregir datos
              </button>
              <button
                type="button"
                className={extending ? 'is-active' : ''}
                aria-pressed={extending}
                onClick={() => chooseMode('maturity_extension')}
              >
                Ampliar vencimiento
              </button>
            </div>

            {!extending ? (
              <>
                <p className="loan-mode-note loan-field--wide">
                  Corrige las condiciones pactadas. El cambio rige desde la fecha inicial, así que recalcula todo el historial de capitalizaciones.
                </p>
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
                <p className="loan-mode-note loan-field--wide">
                  Sólo mueve la fecha de vencimiento. Las demás condiciones quedan como están.
                </p>
                <div className="loan-pair loan-field--wide">
                  <div className="loan-pair__side">
                    <p className="loan-pair__label">Vencimiento actual</p>
                    <p className="loan-pair__before">{formatDateOnly(loan.maturityDate)}</p>
                  </div>
                  <span className="loan-pair__arrow" aria-hidden="true">→</span>
                  <div className="loan-pair__side">
                    <p className="loan-pair__label loan-pair__label--after">Nuevo vencimiento</p>
                    <p className="loan-pair__after">{formatDateOnly(form.newMaturityDate)}</p>
                  </div>
                </div>
                <div className="loan-field loan-field--wide">
                  <label className="loan-field__label" htmlFor="loan-new-maturity">Nuevo vencimiento</label>
                  <input
                    id="loan-new-maturity"
                    type="date"
                    name="newMaturityDate"
                    value={form.newMaturityDate}
                    min={loan.maturityDate}
                    onChange={updateField}
                    aria-invalid={fieldError === 'newMaturityDate'}
                  />
                  <div className="loan-chips">
                    {EXTENSION_SHORTCUTS.map((months) => {
                      const date = shiftDateByMonths(loan.maturityDate, months);
                      return (
                        <button
                          key={months}
                          type="button"
                          className="loan-chip"
                          aria-pressed={form.newMaturityDate === date}
                          onClick={() => applyExtensionShortcut(months)}
                          disabled={loading}
                        >
                          {months === 12 ? '+1 año' : `+${months} meses`}
                        </button>
                      );
                    })}
                  </div>
                </div>
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
                placeholder={extending ? 'Acuerdo de prórroga con la contraparte' : 'Explicá por qué se modifica el contrato'}
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
            <div className="loan-pairs">
              {changedFields.map((field) => (
                <BeforeAfterRow
                  key={field}
                  label={TERM_LABELS[field]}
                  before={formattedTerm(field, preview.currentTerms[field])}
                  after={formattedTerm(field, preview.proposedTerms[field])}
                />
              ))}
              <BeforeAfterRow
                label="Valor actual"
                before={formatMoney(loan.currency, preview.currentValue.value)}
                after={formatMoney(loan.currency, preview.proposedValue.value)}
                emphasis
              />
              <BeforeAfterRow
                label="Proyección"
                before={formatMoney(loan.currency, preview.currentProjection.projectedMaturityValue)}
                after={formatMoney(loan.currency, preview.proposedProjection.projectedMaturityValue)}
                emphasis
              />
              <BeforeAfterRow
                label="Interés futuro"
                before={formatMoney(loan.currency, preview.currentProjection.projectedFutureInterest)}
                after={formatMoney(loan.currency, preview.proposedProjection.projectedFutureInterest)}
              />
            </div>

            <p className="loan-note">
              {preview.input.kind === 'maturity_extension'
                ? 'La ampliación mantiene la misma tasa y continúa el devengamiento hasta el nuevo vencimiento.'
                : 'El cambio aplica desde la fecha inicial del préstamo, por lo que recalcula todo el historial de capitalizaciones.'}
            </p>

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
