import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LoanDetail from '../../src/pages/LoanDetail';
import {
  prepareMovementCorrection,
  prepareMovementDeletion,
  validateCompleteLoanLedger,
  validateMovementDeletionLedger,
} from '../../src/features/loans/loanMovements';
import { calculateLoanTermsChangePreview } from '../../src/features/loans/loanTerms';
import '../../src/index.css';

let loan = {
  id: 'fixture-loan',
  type: 'loan',
  name: 'Fixture auditable',
  currency: 'USD',
  startDate: '2026-09-01',
  maturityDate: '2027-09-01',
  rate: '0.0125',
  rateType: 'monthly_effective',
  capitalizationFrequency: 'monthly',
  calculationVersion: 'loan-v1',
  status: 'active',
  revision: 0,
};

let nextMovementId = 5;
let movements = [
  { id: 'movement-1', type: 'contribution', effectiveDate: '2026-09-01', amount: '710000', note: 'Ingreso inicial' },
  { id: 'movement-2', type: 'contribution', effectiveDate: '2026-09-13', amount: '450000', note: 'Ingreso de mitad de mes' },
  { id: 'movement-3', type: 'contribution', effectiveDate: '2026-10-01', amount: '20000', note: 'Ingreso en capitalización' },
  { id: 'movement-4', type: 'withdrawal', effectiveDate: '2026-10-15', amount: '50000', note: 'Retiro de mitad de mes' },
];

const clone = (value) => structuredClone(value);
const pause = () => new Promise((resolve) => { setTimeout(resolve, 80); });

const repository = {
  async getLoan() {
    await pause();
    return clone(loan);
  },
  async listMovements() {
    await pause();
    return clone(movements).sort((left, right) => (
      left.effectiveDate.localeCompare(right.effectiveDate)
    ));
  },
  async addMovement(_uid, _loanId, input) {
    const movement = { id: `movement-${nextMovementId}`, ...input };
    nextMovementId += 1;
    validateCompleteLoanLedger({ loan, movements: [...movements, movement] });
    movements.push(movement);
    return movement.id;
  },
  async correctMovement(_uid, _loanId, movementId, input) {
    const correction = prepareMovementCorrection({ movements, movementId, correctedData: input });
    validateCompleteLoanLedger({ loan, movements: correction.resultingMovements });
    const reversal = { id: `movement-${nextMovementId}`, ...correction.reversal };
    nextMovementId += 1;
    const replacement = { id: `movement-${nextMovementId}`, ...correction.replacement };
    nextMovementId += 1;
    movements.push(reversal, replacement);
    return { reversalMovementId: reversal.id, replacementMovementId: replacement.id };
  },
  async deleteMovement(_uid, _loanId, movementId, reason) {
    const deletion = prepareMovementDeletion({ movements, movementId, reason });
    validateMovementDeletionLedger({ loan, movements: deletion.resultingMovements });
    const reversal = { id: `void-${movementId}`, ...deletion.reversal };
    movements.push(reversal);
    return { reversalMovementId: reversal.id };
  },
  async previewLoanTermsChange(_uid, _loanId, input) {
    return {
      revision: loan.revision,
      ...calculateLoanTermsChangePreview({ loan, movements, ...input }),
    };
  },
  async applyLoanTermsChange(_uid, _loanId, input) {
    if (input.expectedRevision !== loan.revision) {
      const error = new Error('Fixture terms revision is stale');
      error.code = 'STALE_LOAN_TERMS_REVISION';
      throw error;
    }
    const preview = calculateLoanTermsChangePreview({ loan, movements, ...input });
    loan = {
      ...loan,
      ...preview.candidateLoan,
      id: loan.id,
      revision: loan.revision + 1,
      latestTermsChangeId: `fixture-change-${loan.revision + 1}`,
    };
    return { revision: loan.revision, ...preview };
  },
};

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MemoryRouter initialEntries={['/activos/fixture-loan']}>
      <Routes>
        <Route
          path="/activos/:loanId"
          element={(
            <LoanDetail
              currentUser={{ uid: 'fixture-user' }}
              repository={repository}
              initialAsOfDate="2026-10-20"
            />
          )}
        />
      </Routes>
    </MemoryRouter>
  </React.StrictMode>,
);
