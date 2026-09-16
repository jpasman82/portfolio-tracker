// In-memory atomic-store double. No Firebase initialization or network calls.
export class MemoryStore {
  documents = new Map();
  serial = 0;
  beforeCommit = null;
  afterCommit = null;
  async get(path) { return structuredClone(this.documents.get(path) || null); }
  async list(path) {
    return [...this.documents.entries()].filter(([key]) => key.startsWith(`${path}/`)
      && key.slice(path.length + 1).split('/').length === 1)
      .map(([key, doc]) => ({ id: key.split('/').pop(), data: structuredClone(doc.data), updateTime: doc.version }));
  }
  async commit(writes) {
    if (this.beforeCommit) await this.beforeCommit(writes);
    for (const write of writes) {
      const current = this.documents.get(write.path);
      if (write.version ? current?.version !== write.version : Boolean(current)) {
        throw Object.assign(new Error('Conflict'), { httpStatus: 409 });
      }
    }
    for (const write of writes) this.documents.set(write.path,
      { data: structuredClone(write.data), version: String(++this.serial) });
    if (this.afterCommit) await this.afterCommit(writes);
  }
}

// Synthetic prices, real response shape. Tests use the production trade policy.
export const DATE = '2026-09-15';
export const NOW = '2026-09-15T22:00:00.000Z';
export const row = (symbol, price, currency = 'ARS', extra = {}) => ({
  symbol, security_id: `${symbol}-0002-C-CT-${currency}`, currency, market: 'CT', settlPeriod: '0002', operativeForm: 'C',
  category: /^AL30|^TU27D/.test(symbol) ? 3 : 1,
  trade: price, trades: price > 0 ? 10 : 0, closing_price: 0, previous_close: price - 1,
  Date: DATE, broadcast_time: 165959, ...extra,
});
export const position = (ticker = 'GGAL', quantity = 1, extra = {}) => ({
  id: 'one', data: { assets: [{ ticker, quantity, ...extra }], debt: 0 },
});
export function fixtureByma(overrides = {}) {
  const responses = { acciones: [row('GGAL', 100)], cedears: [], bonosARS: [row('AL30', 1000)],
    bonosUSD: [row('AL30D', 1, 'USD')], bonosEXT: [] };
  const calls = [];
  return { calls, responses,
    async fetchGroup(group) {
      calls.push(group);
      if (overrides[group]) return overrides[group]();
      return { result: structuredClone(responses[group]) };
    },
  };
}
