import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

// Helper modules may reach for Decimal and the engine; React components may not.
const helperSources = [
  './loanUi.js',
  './loanPresentation.js',
].map(read);

const componentSources = [
  './NewLoanForm.jsx',
  './LoanMovementForm.jsx',
  './LoanMovementDeleteDialog.jsx',
  './LoanTermsForm.jsx',
  './LoanFlow.jsx',
  '../../pages/Activos.jsx',
  '../../pages/LoanDetail.jsx',
].map(read);

const sources = [...helperSources, ...componentSources];

describe('Activos UI isolation', () => {
  it.each([
    'portfolioValuation',
    'portfolioSnapshots',
    'brokerPositions',
  ])('does not reference the broker domain: %s', (forbiddenReference) => {
    sources.forEach((source) => expect(source).not.toContain(forbiddenReference));
  });

  it('keeps financial formulas out of React components', () => {
    componentSources.forEach((source) => {
      expect(source).not.toContain('calculateLoanAtDate');
      expect(source).not.toContain('projectLoanToMaturity');
      expect(source).not.toContain('decimal.js');
    });
  });

  it('keeps the presentation helper free of loan arithmetic it does not own', () => {
    const presentation = read('./loanPresentation.js');
    expect(presentation).not.toContain('calculateLoanAtDate');
    expect(presentation).not.toContain('projectLoanToMaturity');
    expect(presentation).not.toContain('loanEngine');
  });

  it('uses the L2B repository instead of ad-hoc Firestore calls', () => {
    componentSources.forEach((source) => {
      expect(source).not.toContain("from 'firebase/firestore'");
    });
  });
});
