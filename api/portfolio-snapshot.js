import { createSign } from 'crypto';

const BYMA_BASE = 'https://apigw.byma.com.ar';
const FIREBASE_PROJECT_ID = 'mi-cartera-tracker';
const SNAPSHOT_COLLECTION = 'portfolioDailySnapshots';
const POSITIONS_COLLECTION = 'brokerPositions';
const BRAZIL_CEDEARS = new Set(['XP', 'NU', 'PAX', 'VALE', 'ITUB', 'EWZ']);
const USD_BROKER_IDS = new Set(['jpm']);
const USD_TICKER_ALIASES = {
  TFU27: 'TU27D',
};

let bymaTokenCache = { token: null, expiresAt: 0 };
let googleTokenCache = { token: null, expiresAt: 0 };

function parseNum(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  return Number(value.toString().replace(/\./g, '').replace(',', '.')) || 0;
}

function snapshotDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

function isWeekdayInArgentina(date = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'short',
  }).format(date);
  return weekday !== 'Sat' && weekday !== 'Sun';
}

function getBymaCredentials() {
  const clientId = process.env.BYMA_CLIENT_ID || process.env.VITE_BYMA_CLIENT_ID;
  const clientSecret = process.env.BYMA_CLIENT_SECRET || process.env.VITE_BYMA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan BYMA_CLIENT_ID/BYMA_CLIENT_SECRET');
  }
  return { clientId, clientSecret };
}

async function getBymaToken() {
  const now = Date.now();
  if (bymaTokenCache.token && now < bymaTokenCache.expiresAt - 60_000) return bymaTokenCache.token;

  const { clientId, clientSecret } = getBymaCredentials();
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'snapshot.read',
  });

  const response = await fetch(`${BYMA_BASE}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) throw new Error(`BYMA token ${response.status}: ${await response.text()}`);

  const data = await response.json();
  bymaTokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 86400) * 1000,
  };
  return bymaTokenCache.token;
}

async function bymaGet(path) {
  const token = await getBymaToken();
  const response = await fetch(`${BYMA_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });

  if (!response.ok) throw new Error(`BYMA ${response.status} en ${path}: ${await response.text()}`);
  return response.json();
}

function closePrice(item) {
  if (item.trade > 0) return item.trade;
  if (item.closing_price > 0) return item.closing_price;
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

async function fetchBymaPrices() {
  const base = '/snapshot/v1';
  const endpoints = {
    acciones: `${base}/equity?group=ACCIONES&operativeForm=CONTADO&currency=ARS&settlPeriod=0002`,
    cedears: `${base}/equity?group=CEDEARS&operativeForm=CONTADO&currency=ARS&settlPeriod=0002`,
    bonosARS: `${base}/fixed_income?group=TITULOSPUBLICOS&market=PPT&operativeForm=CONTADO&currency=ARS&settlPeriod=0002`,
    bonosUSD: `${base}/fixed_income?group=TITULOSPUBLICOS&market=PPT&operativeForm=CONTADO&currency=USD&settlPeriod=0002`,
    bonosEXT: `${base}/fixed_income?group=TITULOSPUBLICOS&market=PPT&operativeForm=CONTADO&currency=EXT&settlPeriod=0002`,
  };

  const [acciones, cedears, bonosARS, bonosUSD, bonosEXT] = await Promise.all([
    bymaGet(endpoints.acciones),
    bymaGet(endpoints.cedears),
    bymaGet(endpoints.bonosARS),
    bymaGet(endpoints.bonosUSD),
    bymaGet(endpoints.bonosEXT),
  ]);

  const accionesMap = toMap(acciones?.result);
  const cedearsMap = toMap(cedears?.result);
  const bonosARSMap = toMap(bonosARS?.result);
  const bonosUSDMap = toMap(bonosUSD?.result);
  const bonosEXTMap = toMap(bonosEXT?.result);
  const al30 = bonosARSMap.AL30;
  const al30d = bonosUSDMap.AL30D ?? bonosUSDMap.AL30;
  const al30c = bonosEXTMap.AL30C ?? bonosEXTMap.AL30;
  const usdBondSymbols = new Set([...Object.keys(bonosUSDMap), ...Object.keys(bonosEXTMap)]);

  return {
    prices: {
      ...accionesMap,
      ...cedearsMap,
      ...bonosARSMap,
      ...bonosUSDMap,
      ...bonosEXTMap,
    },
    usdBondSymbols,
    mep: al30 && al30d ? al30 / al30d : 0,
    cable: al30 && al30c ? al30 / al30c : 0,
  };
}

function isBondTicker(ticker) {
  if (!ticker) return false;
  return /^[A-Z]{2,3}\d{2}[A-Z]?$/i.test(ticker.trim());
}

function getLivePrice(ticker, priceMap, { isUSD, mep, usdBondSymbols }) {
  const symbol = ticker?.toUpperCase().trim();
  if (!symbol) return undefined;
  if (!isUSD) return priceMap[symbol];

  const alias = USD_TICKER_ALIASES[symbol];
  if (alias && priceMap[alias] !== undefined) return priceMap[alias];

  const livePrice = priceMap[symbol];
  if (livePrice === undefined) return undefined;
  if (usdBondSymbols.has(symbol)) return livePrice;
  return mep > 0 ? livePrice / mep : livePrice;
}

function base64url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function getServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    return {
      projectId: account.project_id || account.projectId || FIREBASE_PROJECT_ID,
      clientEmail: account.client_email || account.clientEmail,
      privateKey: account.private_key || account.privateKey,
    };
  }

  return {
    projectId: process.env.FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };
}

async function getGoogleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (googleTokenCache.token && now < googleTokenCache.expiresAt - 60) return googleTokenCache.token;

  const account = getServiceAccount();
  if (!account.clientEmail || !account.privateKey) throw new Error('Faltan credenciales Firebase Admin');

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: account.clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsignedJwt = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(unsignedJwt).sign(account.privateKey, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const assertion = `${unsignedJwt}.${signature}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  if (!response.ok) throw new Error(`Google token ${response.status}: ${await response.text()}`);

  const data = await response.json();
  googleTokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 3600),
  };
  return googleTokenCache.token;
}

function encodeFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  return {
    mapValue: {
      fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeFirestoreValue(item)])),
    },
  };
}

function decodeFirestoreValue(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue.fields || {});
  return undefined;
}

function decodeFirestoreFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

async function firestoreFetch(path, options = {}) {
  const account = getServiceAccount();
  const token = await getGoogleAccessToken();
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${account.projectId}/databases/(default)/documents${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) throw new Error(`Firestore ${response.status}: ${await response.text()}`);
  return response.json();
}

async function listBrokerPositions() {
  const data = await firestoreFetch(`/${POSITIONS_COLLECTION}`);
  return (data.documents || []).map((document) => ({
    id: document.name.split('/').pop(),
    name: document.name,
    data: decodeFirestoreFields(document.fields || {}),
  }));
}

async function patchDocument(collectionName, id, data, fieldPaths) {
  const query = fieldPaths.map((fieldPath) => `updateMask.fieldPaths=${encodeURIComponent(fieldPath)}`).join('&');
  await firestoreFetch(`/${collectionName}/${id}?${query}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encodeFirestoreValue(value)])),
    }),
  });
}

async function updatePositionsAndBuildSnapshot() {
  const nowIso = new Date().toISOString();
  const { prices, usdBondSymbols, mep, cable } = await fetchBymaPrices();
  const positions = await listBrokerPositions();
  const assetsByTicker = {};
  const marketPriceByTicker = {};
  const brokers = [];
  let totalAssetsUsd = 0;
  let totalDebtUsd = 0;
  const positionUpdates = [];

  positions.forEach((position) => {
    const data = position.data;
    const brokerId = position.id;
    const isUSD = USD_BROKER_IDS.has(brokerId);
    const rate = isUSD ? 1 : (mep || parseNum(data.usdRate) || 1);
    let brokerAssetsUsd = 0;
    const brokerAssets = [];

    const updatedAssets = (data.assets || []).map((asset) => {
      if (!asset?.ticker) return asset;
      const ticker = asset.ticker.toUpperCase().trim();
      const livePrice = getLivePrice(ticker, prices, { isUSD, mep, usdBondSymbols });
      const isBond = asset.isBond || isBondTicker(ticker);
      return livePrice !== undefined ? { ...asset, ticker, price: livePrice, isBond } : { ...asset, ticker, isBond };
    });

    for (const asset of updatedAssets) {
      if (!asset?.ticker || BRAZIL_CEDEARS.has(asset.ticker)) continue;
      const quantity = parseNum(asset.quantity);
      const isBond = asset.isBond || isBondTicker(asset.ticker);
      const divisor = isBond ? 100 : 1;
      const unitPrice = parseNum(asset.price);
      const unitPriceUsd = unitPrice / rate / divisor;
      const valueUsd = quantity * unitPriceUsd;
      const valueArs = valueUsd * (mep || rate);
      if (valueUsd === 0) continue;

      const row = {
        brokerId,
        ticker: asset.ticker,
        quantity,
        isBond,
        unitPrice,
        unitPriceUsd,
        valueUsd,
        valueArs,
      };

      brokerAssets.push(row);
      brokerAssetsUsd += valueUsd;
      totalAssetsUsd += valueUsd;

      if (!assetsByTicker[asset.ticker]) {
        assetsByTicker[asset.ticker] = { ticker: asset.ticker, quantity: 0, valueUsd: 0, valueArs: 0 };
      }
      assetsByTicker[asset.ticker].quantity += quantity;
      assetsByTicker[asset.ticker].valueUsd += valueUsd;
      assetsByTicker[asset.ticker].valueArs += valueArs;

      if (!marketPriceByTicker[asset.ticker]) {
        marketPriceByTicker[asset.ticker] = {
          ticker: asset.ticker,
          isBond,
          currency: isUSD ? 'USD' : 'ARS',
          unitPrice,
          unitPriceUsd,
          mepRate: mep,
          cableRate: cable,
          quantity: 0,
          valueUsd: 0,
          valueArs: 0,
          brokers: [],
        };
      }
      marketPriceByTicker[asset.ticker].quantity += quantity;
      marketPriceByTicker[asset.ticker].valueUsd += valueUsd;
      marketPriceByTicker[asset.ticker].valueArs += valueArs;
      marketPriceByTicker[asset.ticker].brokers.push(brokerId);
    }

    const debtUsd = parseNum(data.debt);
    totalDebtUsd += debtUsd;
    brokers.push({
      brokerId,
      rate,
      assetsUsd: brokerAssetsUsd,
      debtUsd,
      netUsd: brokerAssetsUsd - debtUsd,
      netArs: (brokerAssetsUsd - debtUsd) * (mep || rate),
      lastUpdated: nowIso,
      assets: brokerAssets,
    });

    positionUpdates.push(patchDocument(POSITIONS_COLLECTION, brokerId, {
      assets: updatedAssets,
      usdRate: isUSD ? 1 : (mep || data.usdRate || 1),
      lastUpdated: nowIso,
    }, ['assets', 'usdRate', 'lastUpdated']));
  });

  await Promise.all(positionUpdates);

  const netUsd = totalAssetsUsd - totalDebtUsd;
  return {
    date: snapshotDate(),
    source: 'vercel-cron-close',
    capturedAt: nowIso,
    updatedAt: nowIso,
    rates: { mep, cable },
    totals: {
      assetsUsd: totalAssetsUsd,
      debtUsd: totalDebtUsd,
      netUsd,
      assetsArs: totalAssetsUsd * mep,
      debtArs: totalDebtUsd * mep,
      netArs: netUsd * mep,
    },
    brokers,
    assets: Object.values(assetsByTicker).sort((a, b) => b.valueUsd - a.valueUsd),
    marketPrices: Object.values(marketPriceByTicker)
      .map((item) => ({ ...item, brokers: [...new Set(item.brokers)] }))
      .sort((a, b) => a.ticker.localeCompare(b.ticker)),
  };
}

function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido' });
  }

  try {
    if (!isWeekdayInArgentina() && req.query?.force !== 'true') {
      return res.status(200).json({ skipped: true, reason: 'Fin de semana en Argentina' });
    }

    const snapshot = await updatePositionsAndBuildSnapshot();
    await patchDocument(SNAPSHOT_COLLECTION, snapshot.date, snapshot, Object.keys(snapshot));

    return res.status(200).json({
      ok: true,
      date: snapshot.date,
      netUsd: snapshot.totals.netUsd,
      netArs: snapshot.totals.netArs,
      mep: snapshot.rates.mep,
      assets: snapshot.assets.length,
      brokers: snapshot.brokers.length,
    });
  } catch (err) {
    console.error('[portfolio-snapshot]', err);
    return res.status(500).json({ error: err.message });
  }
}
