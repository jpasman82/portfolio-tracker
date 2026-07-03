import { collection, doc, getDocs, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { fetchPortfolioValuation, getPortfolioSnapshotDate } from './portfolioValuation';

const SNAPSHOT_COLLECTION = 'portfolioDailySnapshots';

export async function saveDailyPortfolioSnapshot({
  source = 'manual',
  refreshPrices = false,
  date = new Date(),
} = {}) {
  const valuation = await fetchPortfolioValuation({ refreshPrices });
  const snapshotDate = getPortfolioSnapshotDate(date);
  const payload = {
    date: snapshotDate,
    source,
    capturedAt: valuation.capturedAt,
    updatedAt: serverTimestamp(),
    rates: valuation.rates,
    totals: valuation.totals,
    brokers: valuation.brokers,
    assets: valuation.assets,
    marketPrices: valuation.marketPrices,
  };

  await setDoc(doc(db, SNAPSHOT_COLLECTION, snapshotDate), payload, { merge: true });
  return payload;
}

export async function saveManualPortfolioSnapshot({
  date,
  netUsd,
  mepRate = 0,
} = {}) {
  const parsedUsd = Number(netUsd) || 0;
  const parsedMep = Number(mepRate) || 0;
  if (!date) throw new Error('Falta la fecha del registro.');
  if (parsedUsd <= 0) throw new Error('El valor USD tiene que ser mayor a cero.');

  const payload = {
    date,
    source: 'manual-baseline',
    capturedAt: new Date().toISOString(),
    updatedAt: serverTimestamp(),
    rates: {
      mep: parsedMep,
      cable: 0,
    },
    totals: {
      assetsUsd: parsedUsd,
      debtUsd: 0,
      netUsd: parsedUsd,
      assetsArs: parsedMep > 0 ? parsedUsd * parsedMep : 0,
      debtArs: 0,
      netArs: parsedMep > 0 ? parsedUsd * parsedMep : 0,
    },
    brokers: [],
    assets: [],
    marketPrices: [],
  };

  await setDoc(doc(db, SNAPSHOT_COLLECTION, date), payload, { merge: true });
  return payload;
}

export async function fetchPortfolioSnapshots() {
  const snapshotsQuery = query(collection(db, SNAPSHOT_COLLECTION), orderBy('date', 'asc'));
  const snap = await getDocs(snapshotsQuery);
  return snap.docs.map((document) => ({ id: document.id, ...document.data() }));
}
