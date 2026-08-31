import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { assetDictionary } from './dictionary';
import { parseNum } from './numberFormat';
import { fetchAllPrices, getBrokerLivePrice, getCclRate, getMepRate, getPriceMeta, isBondTicker } from './priceService';
import { isUsdBroker } from './brokers';
import { esMercadoAbierto } from './marketHours';

const BRAZIL_CEDEARS = new Set(['XP', 'NU', 'PAX', 'VALE', 'ITUB', 'EWZ']);

export const parsePortfolioNumber = parseNum;

export function getPortfolioSnapshotDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function fetchPortfolioValuation({ refreshPrices = esMercadoAbierto() } = {}) {
  let priceMap = {};
  if (refreshPrices) {
    priceMap = await fetchAllPrices();
  }

  const mepRate = getMepRate();
  const cableRate = getCclRate();
  const priceMeta = getPriceMeta();
  const positionsSnap = await getDocs(collection(db, 'brokerPositions'));

  const assetsByTicker = {};
  const marketPriceByTicker = {};
  const brokers = [];
  let totalAssetsUsd = 0;
  let totalDebtUsd = 0;

  positionsSnap.forEach((document) => {
    const data = document.data();
    const brokerId = document.id;
    const isUSD = isUsdBroker(brokerId);
    const rate = isUSD ? 1 : (mepRate || parsePortfolioNumber(data.usdRate) || 1);
    const brokerAssets = [];
    let brokerAssetsUsd = 0;

    (data.assets || []).forEach((asset) => {
      if (!asset?.ticker) return;
      const ticker = asset.ticker.toUpperCase().trim();
      if (BRAZIL_CEDEARS.has(ticker)) return;

      const quantity = parsePortfolioNumber(asset.quantity);
      const isBond = asset.isBond || isBondTicker(ticker);
      const divisor = isBond ? 100 : 1;
      const unitPrice = getBrokerLivePrice(ticker, priceMap, { isUSD, mepRate }) ?? parsePortfolioNumber(asset.price);
      const unitPriceUsd = unitPrice / rate / divisor;
      const valueUsd = quantity * unitPriceUsd;
      const valueArs = valueUsd * (mepRate || rate);
      const changePercent = priceMeta[ticker]?.changePercent ?? null;

      if (valueUsd === 0) return;

      const row = {
        brokerId,
        ticker,
        quantity,
        isBond,
        unitPrice,
        unitPriceUsd,
        valueUsd,
        valueArs,
        changePercent,
      };
      brokerAssets.push(row);
      brokerAssetsUsd += valueUsd;
      totalAssetsUsd += valueUsd;

      if (!assetsByTicker[ticker]) {
        assetsByTicker[ticker] = {
          ticker,
          quantity: 0,
          valueUsd: 0,
          valueArs: 0,
          changePercent,
        };
      }
      assetsByTicker[ticker].quantity += quantity;
      assetsByTicker[ticker].valueUsd += valueUsd;
      assetsByTicker[ticker].valueArs += valueArs;
      if (changePercent !== null) assetsByTicker[ticker].changePercent = changePercent;

      if (!marketPriceByTicker[ticker]) {
        marketPriceByTicker[ticker] = {
          ticker,
          isBond,
          currency: isUSD ? 'USD' : 'ARS',
          unitPrice,
          unitPriceUsd,
          mepRate: mepRate || 0,
          cableRate: cableRate || 0,
          quantity: 0,
          valueUsd: 0,
          valueArs: 0,
          brokers: [],
          changePercent,
        };
      }
      marketPriceByTicker[ticker].quantity += quantity;
      marketPriceByTicker[ticker].valueUsd += valueUsd;
      marketPriceByTicker[ticker].valueArs += valueArs;
      marketPriceByTicker[ticker].brokers.push(brokerId);
      if (changePercent !== null) marketPriceByTicker[ticker].changePercent = changePercent;
    });

    const debtUsd = parsePortfolioNumber(data.debt);
    totalDebtUsd += debtUsd;

    brokers.push({
      brokerId,
      rate,
      assetsUsd: brokerAssetsUsd,
      debtUsd,
      netUsd: brokerAssetsUsd - debtUsd,
      netArs: (brokerAssetsUsd - debtUsd) * (mepRate || rate),
      lastUpdated: data.lastUpdated || null,
      assets: brokerAssets,
    });
  });

  const netUsd = totalAssetsUsd - totalDebtUsd;
  const effectiveMep = mepRate || 0;
  const assets = Object.values(assetsByTicker).sort((a, b) => b.valueUsd - a.valueUsd);
  const marketPrices = Object.values(marketPriceByTicker)
    .map((item) => ({ ...item, brokers: [...new Set(item.brokers)] }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  const grouped = groupPortfolioAssets(assets, totalDebtUsd);

  return {
    capturedAt: new Date().toISOString(),
    rates: {
      mep: effectiveMep,
      cable: cableRate || 0,
    },
    totals: {
      assetsUsd: totalAssetsUsd,
      debtUsd: totalDebtUsd,
      netUsd,
      assetsArs: totalAssetsUsd * effectiveMep,
      debtArs: totalDebtUsd * effectiveMep,
      netArs: netUsd * effectiveMep,
    },
    brokers,
    assets,
    marketPrices,
    grouped,
  };
}

export function groupPortfolioAssets(assets, totalDebtUsd = 0) {
  const grouped = {};

  assets.forEach((item) => {
    const info = assetDictionary[item.ticker] || { cat: 'Otros', sub: 'Sin Clasificar', icon: '?' };
    if (!grouped[info.cat]) grouped[info.cat] = { total: 0, subs: {} };
    if (!grouped[info.cat].subs[info.sub]) grouped[info.cat].subs[info.sub] = { icon: info.icon, total: 0, assets: [] };

    grouped[info.cat].subs[info.sub].assets.push(item);
    grouped[info.cat].subs[info.sub].total += item.valueUsd;
    grouped[info.cat].total += item.valueUsd;
  });

  if (totalDebtUsd > 0) {
    const debtAsset = {
      ticker: 'DEUDA CAUCIÓN',
      quantity: 1,
      valueUsd: -totalDebtUsd,
      valueArs: 0,
      changePercent: null,
    };
    if (!grouped.Pasivos) grouped.Pasivos = { total: 0, subs: {} };
    grouped.Pasivos.subs.Deuda = { icon: '-', total: -totalDebtUsd, assets: [debtAsset] };
    grouped.Pasivos.total = -totalDebtUsd;
  }

  Object.keys(grouped).forEach((cat) => {
    Object.keys(grouped[cat].subs).forEach((sub) => {
      grouped[cat].subs[sub].assets.sort((a, b) => b.valueUsd - a.valueUsd);
    });
  });

  return grouped;
}
