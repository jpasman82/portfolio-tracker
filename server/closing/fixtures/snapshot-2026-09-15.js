// Sanitized excerpts observed at 15:18 ART. These are NOT post-close captures.
// Post-cutoff scenarios in tests explicitly simulate the capture time only.
export const observedAt = '2026-09-15T18:18:07.623Z';
export const observed = [
  ['acciones', 'GGAL', 'ARS', 1, 0, 6840, 6775, 151735, 3528],
  ['acciones', 'YPFD', 'ARS', 1, 0, 8965, 9145, 151806, 10774],
  ['acciones', 'POLL', 'ARS', 1, 298, 298, 0, 92509, 0],
  ['cedears', 'AAPL', 'ARS', 23, 0, 26640, 26360, 151740, 1223],
  ['cedears', 'SPY', 'ARS', 23, 0, 20270, 20150, 151807, 5453],
  ['bonosARS', 'AL30', 'ARS', 3, 0, 85250, 85000, 151808, 29298],
  ['bonosUSD', 'AL30D', 'USD', 3, 0, 55.57, 55.52, 151808, 17780],
  ['bonosEXT', 'AL30C', 'EXT', 3, 0, 53.36, 53.33, 151808, 11312],
].map(([group, symbol, currency, category, closing_price, previous_close, trade, broadcast_time, trades]) => ({
  group, row: { symbol, security_id: `${symbol}-0002-C-CT-${currency}`, currency, category,
    closing_price, previous_close, trade, broadcast_time, trades, Date: '2026-09-15',
    market: 'CT', operativeForm: 'C', settlPeriod: '0002', ...(category === 3 ? { settlDate: '20300709' } : {}) },
}));
