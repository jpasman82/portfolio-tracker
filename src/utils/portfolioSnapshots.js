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
  };

  await setDoc(doc(db, SNAPSHOT_COLLECTION, snapshotDate), payload, { merge: true });
  return payload;
}

export async function fetchPortfolioSnapshots() {
  const snapshotsQuery = query(collection(db, SNAPSHOT_COLLECTION), orderBy('date', 'asc'));
  const snap = await getDocs(snapshotsQuery);
  return snap.docs.map((document) => ({ id: document.id, ...document.data() }));
}
