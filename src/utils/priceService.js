const STOCKS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTQAIR6KHV18vjerj20-Xizsi3nhbof-luaoiQj1ebU_K2Ttpz_nm9xJlNGAdpotn_8_7Jn-7wB36qc/pub?output=csv";
const BONDS_CSV_URL = import.meta.env.VITE_BONDS_CSV_URL || null;
const MAE_API_KEY  = import.meta.env.VITE_MAE_API_KEY;

// En dev: Vite proxy evita CORS (la request sale desde tu máquina, no desde Google Cloud).
// En prod: llamada directa — funciona si el API tiene CORS habilitado para requests con API key.
const MAE_URL = import.meta.env.DEV
  ? '/api/mae/mercado/cotizaciones/rentafija'
  : 'https://api.mae.com.ar/MarketData/v1/mercado/cotizaciones/rentafija';

function parseCsvPrice(raw) {
  if (!raw) return NaN;
  let s = raw.trim();
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  return parseFloat(s);
}

async function fetchSheetPrices(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo leer el sheet (${res.status})`);

  const priceMap = {};
  (await res.text()).split('\n').forEach(row => {
    const cols = row.split(/,|;/);
    if (cols.length < 2) return;
    const ticker = cols[0].replace(/"/g, '').replace('BCBA:', '').replace('NASDAQ:', '').trim().toUpperCase();
    const price  = parseCsvPrice(cols[1].replace(/"/g, ''));
    if (ticker && !isNaN(price) && price > 0) priceMap[ticker] = price;
  });

  return priceMap;
}

async function fetchA3Prices() {
  if (!MAE_API_KEY) throw new Error('VITE_MAE_API_KEY no configurada');

  const res = await fetch(MAE_URL, {
    headers: { 'x-api-key': MAE_API_KEY }
  });

  if (!res.ok) throw new Error(`a3 API error ${res.status}`);

  const raw   = await res.json();
  const items = Array.isArray(raw) ? raw
    : (raw.data ?? raw.items ?? raw.cotizaciones ?? raw.result ?? raw.titulos ?? []);

  // LOG TEMPORAL — muestra la estructura del primer item para ajustar campos
  if (items.length > 0) {
    console.log('[a3 API] Total items:', items.length);
    console.log('[a3 API] Primer item (campos):', JSON.stringify(items[0]));
  } else {
    console.warn('[a3 API] La respuesta llegó pero el array está vacío. Raw:', JSON.stringify(raw).substring(0, 500));
  }

  const priceMap = {};
  items.forEach(item => {
    const ticker = (
      item.especie ?? item.Especie ?? item.simbolo ?? item.Simbolo ??
      item.ticker  ?? item.Ticker  ?? item.symbol  ?? ''
    ).toString().toUpperCase().trim();

    const price = Number(
      item.precioUltimo ?? item.ultimoPrecio ?? item.ultimo ?? item.Ultimo ??
      item.precioCierre ?? item.PrecioCierre ?? item.precio ?? item.Precio ??
      item.cierre       ?? item.Cierre       ?? 0
    );

    if (ticker && !isNaN(price) && price > 0) priceMap[ticker] = price;
  });

  console.log('[a3 API] Tickers parseados:', Object.keys(priceMap).length, '— muestra:', Object.entries(priceMap).slice(0, 5));

  return priceMap;
}

/**
 * Devuelve el dólar MEP.
 * Prioridad: fila "MEP" directa en el sheet (escrita por Apps Script) →
 *            cálculo AL30 / AL30D → null si no hay datos.
 */
export function getMepRate(priceMap) {
  if (priceMap['MEP']  > 0) return priceMap['MEP'];
  if (priceMap['AL30'] > 0 && priceMap['AL30D'] > 0) return priceMap['AL30'] / priceMap['AL30D'];
  return null;
}

/**
 * Combina precios de todas las fuentes disponibles:
 *   1. Sheet de acciones (Google Sheets CSV)
 *   2. Sheet de bonos / MEP (Apps Script → Ambito, si VITE_BONDS_CSV_URL está configurada)
 *   3. API de a3 / MAE (renta fija completa)
 * Si alguna fuente falla, continúa con las demás.
 * Lanza error solo si todas las fuentes fallan.
 */
export async function fetchAllPrices() {
  const sources = [
    fetchSheetPrices(STOCKS_CSV_URL),
    ...(BONDS_CSV_URL ? [fetchSheetPrices(BONDS_CSV_URL)] : []),
    fetchA3Prices(),
  ];

  const results = await Promise.allSettled(sources);
  const prices  = {};

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      Object.assign(prices, r.value);
    } else {
      const label = i === 0 ? 'sheet acciones' : i === 1 && BONDS_CSV_URL ? 'sheet bonos' : 'a3 API';
      console.warn(`[priceService] ${label} falló:`, r.reason?.message);
    }
  });

  if (Object.keys(prices).length === 0) {
    throw new Error('No se pudieron obtener precios de ninguna fuente');
  }

  return prices;
}
