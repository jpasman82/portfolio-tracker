import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sources = [
  new URL('./loanUi.js', import.meta.url),
  new URL('./NewLoanForm.jsx', import.meta.url),
  new URL('../../pages/Activos.jsx', import.meta.url),
  new URL('../../pages/LoanDetail.jsx', import.meta.url),
].map((url) => readFileSync(fileURLToPath(url), 'utf8'));

describe('Activos UI isolation', () => {
  it.each([
    'portfolioValuation',
    'portfolioSnapshots',
    'brokerPositions',
  ])('does not reference the broker domain: %s', (forbiddenReference) => {
    sources.forEach((source) => expect(source).not.toContain(forbiddenReference));
  });

  it('keeps financial formulas out of React components', () => {
    const componentSources = sources.slice(1);
    componentSources.forEach((source) => {
      expect(source).not.toContain('calculateLoanAtDate');
      expect(source).not.toContain('projectLoanToMaturity');
      expect(source).not.toContain('decimal.js');
    });
  });

  it('uses the L2B repository instead of ad-hoc Firestore calls', () => {
    const componentSources = sources.slice(1);
    componentSources.forEach((source) => {
      expect(source).not.toContain("from 'firebase/firestore'");
    });
  });
});
