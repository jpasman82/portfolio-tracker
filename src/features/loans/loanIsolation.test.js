import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const featureDirectory = dirname(fileURLToPath(import.meta.url));
const productionFiles = ['loanDates.js', 'loanModel.js', 'loanEngine.js'];
const persistenceFiles = ['loanSerialization.js', 'loanMovements.js', 'loanRepository.js'];

describe('loan engine isolation', () => {
  it.each(productionFiles)('%s has no forbidden domain imports', (fileName) => {
    const source = readFileSync(join(featureDirectory, fileName), 'utf8');

    expect(source).not.toMatch(/from\s+['"]firebase(?:\/|['"])/i);
    expect(source).not.toMatch(/from\s+['"]react(?:\/|['"])/i);
    expect(source).not.toMatch(/portfolioValuation/i);
    expect(source).not.toMatch(/portfolioSnapshots/i);
    expect(source).not.toMatch(/priceService/i);
    expect(source).not.toMatch(/\/brokers(?:\.js)?['"]/i);
  });

  it('contains no production special case for the Reclus fixture', () => {
    for (const fileName of [...productionFiles, ...persistenceFiles]) {
      const source = readFileSync(join(featureDirectory, fileName), 'utf8');
      expect(source).not.toMatch(/Reclus/i);
    }
  });

  it.each(persistenceFiles)('%s remains isolated from brokers and snapshots', (fileName) => {
    const source = readFileSync(join(featureDirectory, fileName), 'utf8');

    expect(source).not.toMatch(/portfolioValuation/i);
    expect(source).not.toMatch(/portfolioSnapshots/i);
    expect(source).not.toMatch(/priceService/i);
    expect(source).not.toMatch(/brokerPositions/i);
    expect(source).not.toMatch(/\/brokers(?:\.js)?['"]/i);
  });

  it('keeps serialization independent from Firebase and React', () => {
    const source = readFileSync(join(featureDirectory, 'loanSerialization.js'), 'utf8');
    expect(source).not.toMatch(/from\s+['"]firebase(?:\/|['"])/i);
    expect(source).not.toMatch(/from\s+['"]react(?:\/|['"])/i);
  });
});
