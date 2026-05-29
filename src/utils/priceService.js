// src/utils/priceService.js

import { bymaGet } from './bymaService';

// ─── Cache de módulo ──────────────────────────────────────────────────────────
let _precios = {};
let _priceMeta = {};
let _mep     = null;
let _cable   = null;

// ─── Endpoints ────────────────────────────────────────────────────────────────
const BASE = '/snapshot/v1';

const EP = {
  acciones:  `${BASE}/equity?group=ACCIONES&operativeForm=CONTADO&currency=ARS&settlPeriod=0002`,
  cedears:   `${BASE}/equity?group=CEDEARS&operativeForm=CONTADO&currency=ARS&settlPeriod=0002`,
  bonosARS:  `${BASE}/fixed_income?group=TITULOSPUBLICOS&market=PPT&operativeForm=CONTADO&currency=ARS`,
  bonosUSD:  `${BASE}/fixed_income?group=TITULOSPUBLICOS&market=PPT&operativeForm=CONTADO&currency=USD`,
  bonosEXT:  `${BASE}/fixed_income?group=TITULOSPUBLICOS&market=PPT&operativeForm=CONTADO&currency=EXT`,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function closePrice(item) {
  if (item.trade          > 0) return item.trade;
  if (item.closing_price  > 0) return item.closing_price;
  if (item.previous_close > 0) return item.previous_close;
  if (item.best_purchase_price > 0) return item.best_purchase_price;
  return 0;
}

function changePrice(item) {
  if (item.closing_price  > 0) return item.closing_price;
  if (item.trade          > 0) return item.trade;
  if (item.previous_close > 0) return item.previous_close;
  if (item.best_purchase_price > 0) return item.best_purchase_price;
  return 0;
}

function toMap(items = []) {
  const map = {};
  for (const item of items) {
    const price = closePrice(item);
    if (item.symbol && price > 0) map[item.symbol] = price;
  }
  return map;
}

function toMetaMap(items = []) {
  const map = {};
  for (const item of items) {
    const price = changePrice(item);
    const previousClose = item.previous_close > 0 ? item.previous_close : 0;
    if (!item.symbol || price <= 0) continue;

    map[item.symbol] = {
      price,
      previousClose,
      change: previousClose > 0 ? price - previousClose : null,
      changePercent: previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : null,
    };
  }
  return map;
}

async function fetchMap(endpoint) {
  try {
    const data = await bymaGet(endpoint);
    const items = data?.result ?? [];
    return { prices: toMap(items), meta: toMetaMap(items) };
  } catch (err) {
    console.error(`[priceService] Error en ${endpoint}:`, err.message);
    return { prices: {}, meta: {} };
  }
}

// ─── API pública ──────────────────────────────────────────────────────────────

export async function fetchAllPrices() {
  const [acciones, cedears, bonosARS, bonosUSD, bonosEXT] = await Promise.allSettled([
    fetchMap(EP.acciones),
    fetchMap(EP.cedears),
    fetchMap(EP.bonosARS),
    fetchMap(EP.bonosUSD),   // AL30D → precio en USD para MEP
    fetchMap(EP.bonosEXT),   // AL30C → precio en USD exterior para Cable/CCL
  ]);

  const accionesData = acciones.status === 'fulfilled' ? acciones.value : { prices: {}, meta: {} };
  const cedearsData  = cedears.status  === 'fulfilled' ? cedears.value  : { prices: {}, meta: {} };
  const bonosARSData = bonosARS.status === 'fulfilled' ? bonosARS.value : { prices: {}, meta: {} };
  const bonosUSDData = bonosUSD.status === 'fulfilled' ? bonosUSD.value : { prices: {}, meta: {} };
  const bonosEXTData = bonosEXT.status === 'fulfilled' ? bonosEXT.value : { prices: {}, meta: {} };

  const arsMap = bonosARSData.prices;
  const usdMap = bonosUSDData.prices;
  const extMap = bonosEXTData.prices;

  _precios = {
    ...accionesData.prices,
    ...cedearsData.prices,
    ...arsMap,
    ...usdMap,
    ...extMap,
  };

  _priceMeta = {
    ...accionesData.meta,
    ...cedearsData.meta,
    ...bonosARSData.meta,
    ...bonosUSDData.meta,
    ...bonosEXTData.meta,
  };

  // MEP   = AL30(ARS) / AL30D(USD)  →  pesos por dólar MEP
  // Cable = AL30(ARS) / AL30C(EXT)  →  pesos por dólar cable
  const al30    = arsMap['AL30'];
  const al30d   = usdMap['AL30D'] ?? usdMap['AL30'];
  const al30c   = extMap['AL30C'] ?? extMap['AL30'];

  console.log('[priceService] AL30:', al30, '| AL30D:', al30d, '| AL30C:', al30c);

  _mep   = (al30 && al30d) ? al30 / al30d : null;
  _cable = (al30 && al30c) ? al30 / al30c : null;

  if (_mep)   console.log('[priceService] MEP (BYMA):', _mep.toFixed(2));
  if (_cable) console.log('[priceService] Cable (BYMA):', _cable.toFixed(2));

  if (!_mep || !_cable) {
    console.warn('[priceService] MEP/Cable incompletos desde BYMA — consultando dolarapi.com...');
    try {
      const [resMep, resCable] = await Promise.all([
        _mep   ? Promise.resolve(null) : fetch('https://dolarapi.com/v1/dolares/bolsa'),
        _cable ? Promise.resolve(null) : fetch('https://dolarapi.com/v1/dolares/contadoconliqui'),
      ]);
      if (resMep) {
        const d = await resMep.json();
        _mep = d.venta ?? d.compra ?? null;
        if (_mep) console.log('[priceService] MEP (dolarapi):', _mep.toFixed(2));
      }
      if (resCable) {
        const d = await resCable.json();
        _cable = d.venta ?? d.compra ?? null;
        if (_cable) console.log('[priceService] Cable (dolarapi):', _cable.toFixed(2));
      }
    } catch (e) {
      console.warn('[priceService] Fallback dolarapi falló:', e.message);
    }
  }

  return _precios;
}

export function getMepRate()  { return _mep;   }
export function getCclRate()  { return _cable;  }
export function getPriceMeta() { return _priceMeta; }

export function isBondTicker(ticker) {
  if (!ticker) return false;
  return /^[A-Z]{2,3}\d{2}[A-Z]?$/i.test(ticker.trim());
}

export async function fetchPreciosYDolares() {
  const precios = await fetchAllPrices();
  return { precios, mep: _mep, cable: _cable };
}
