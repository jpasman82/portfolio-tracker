import { collection, doc, getDocs, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const SNAPSHOT_COLLECTION = 'portfolioDailySnapshots';
const MANUAL_BASELINE_COLLECTION = 'portfolioManualBaselines';

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

  await setDoc(doc(db, MANUAL_BASELINE_COLLECTION, date), payload, { merge: true });
  return payload;
}

export async function fetchPortfolioSnapshots() {
  const ordered = (name) => query(collection(db, name), orderBy('date', 'asc'));
  const [officialResult, manualResult] = await Promise.allSettled([
    getDocs(ordered(SNAPSHOT_COLLECTION)),
    getDocs(ordered(MANUAL_BASELINE_COLLECTION)),
  ]);
  if (officialResult.status === 'rejected') throw officialResult.reason;
  const official = officialResult.value;
  const manual = manualResult.status === 'fulfilled' ? manualResult.value : { docs: [] };
  if (manualResult.status === 'rejected') {
    console.warn('[portfolioSnapshots] Manual baselines unavailable:', manualResult.reason?.message || 'unknown error');
  }
  const byDate = new Map(manual.docs.map((document) => [document.id,
    { ...document.data(), id: `manual:${document.id}`, historyType: 'manual-baseline' }]));
  for (const document of official.docs) byDate.set(document.id,
    { ...document.data(), id: `official:${document.id}`, historyType: 'official' });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
