import { collection, getDocs, runTransaction } from 'firebase/firestore';
import { db } from '../firebase/config';
import { parseNum } from './numberFormat';
import { fetchAllPrices, getBrokerLivePrice, getCclRate, getMepRate, getPriceMeta, isBondTicker } from './priceService';
import { isUsdBroker } from './brokers';
import { esMercadoAbierto } from './marketHours';
import { buildPortfolioValuation } from './portfolioValuationCore';

export { groupPortfolioAssets } from './portfolioValuationCore';
export const parsePortfolioNumber = parseNum;

export function getPortfolioSnapshotDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

let refreshInFlight = null;

// Read fresh quantities in a transaction; quote refreshes only change prices and FX.
export async function refreshBrokerPrices({ force = false } = {}) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const snapshot = await getDocs(collection(db, 'brokerPositions'));
    const now = Date.now();
    const minuteStart = Math.floor(now / 60000) * 60000;
    const alreadyFresh = snapshot.docs.length > 0 && snapshot.docs.every(document => {
      const updated = Date.parse(document.data().lastUpdated);
      return updated >= minuteStart && updated <= now;
    });
    // Navigation in the same minute keeps the quotes already shown in Brokers.
    if (!force && alreadyFresh) {
      if (!getMepRate()) await fetchAllPrices();
      return true;
    }
    const priceMap = await fetchAllPrices();
    const mepRate = getMepRate();
    const hasMarketData = Object.keys(priceMap).length > 0 || mepRate !== null;
    if (!hasMarketData) return false;
    const nowIso = new Date().toISOString();
    await runTransaction(db, async transaction => {
      const current = await Promise.all(snapshot.docs.map(document => transaction.get(document.ref)));
      for (const document of current) {
        if (!document.exists()) continue;
        const data = document.data();
        const isUSD = isUsdBroker(document.id);
        let changed = false;
        const updatedAssets = (data.assets || []).map(asset => {
          if (!asset?.ticker) return asset;
          const ticker = asset.ticker.toUpperCase().trim();
          const price = getBrokerLivePrice(ticker, priceMap, { isUSD, mepRate });
          const isBond = Boolean(asset.isBond || isBondTicker(ticker));
          if (price !== undefined && (Math.abs(parseNum(asset.price) - price) > 0.001 || asset.isBond !== isBond)) {
            changed = true;
            return { ...asset, price, isBond };
          }
          if (isBond !== asset.isBond) {
            changed = true;
            return { ...asset, isBond };
          }
          return asset;
        });
        const payload = { lastUpdated: nowIso };
        if (changed) payload.assets = updatedAssets;
        if (!isUSD && mepRate > 0) payload.usdRate = mepRate;
        transaction.update(document.ref, payload);
      }
    });
    return true;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function fetchPortfolioValuation({ refreshPrices = esMercadoAbierto() } = {}) {
  if (refreshPrices) await refreshBrokerPrices();
  const snapshot = await getDocs(collection(db, 'brokerPositions'));
  return buildPortfolioValuation(snapshot.docs.map(document => ({ id: document.id, data: document.data() })), {
    mepRate: getMepRate(), cableRate: getCclRate(), priceMeta: getPriceMeta(),
  });
}
