const RISK_COUNTRY_URL = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais';

let _cache = {
  data: null,
  fetchedAt: 0,
};

const CACHE_MS = 5 * 60 * 1000;

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function fetchRiskCountry() {
  const now = Date.now();
  if (_cache.data && now - _cache.fetchedAt < CACHE_MS) return _cache.data;

  const res = await fetch(RISK_COUNTRY_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`[ArgentinaDatos] ${res.status} en riesgo pais`);

  const series = await res.json();
  if (!Array.isArray(series) || series.length === 0) {
    throw new Error('[ArgentinaDatos] Riesgo pais sin datos');
  }

  const latest = series[series.length - 1];
  const previous = [...series]
    .reverse()
    .find((item) => item.fecha !== latest.fecha && toNumber(item.valor) !== null);

  const value = toNumber(latest.valor);
  const previousValue = toNumber(previous?.valor);

  const data = {
    value,
    date: latest.fecha,
    previousValue,
    previousDate: previous?.fecha ?? null,
    change: value !== null && previousValue !== null ? value - previousValue : null,
    changePercent:
      value !== null && previousValue > 0
        ? ((value - previousValue) / previousValue) * 100
        : null,
  };

  _cache = { data, fetchedAt: now };
  return data;
}
