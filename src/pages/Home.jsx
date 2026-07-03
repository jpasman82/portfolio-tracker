import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { db, auth } from '../firebase/config';
import { fetchAllPrices, getMepRate, getCclRate, getPriceMeta, isBondTicker, getBrokerLivePrice } from '../utils/priceService';
import { fetchRiskCountry } from '../utils/riskCountryService';
import { BROKERS, createEmptyBrokerData, isUsdBroker } from '../utils/brokers';
import { useHideBottomNavOnScroll } from '../utils/useHideBottomNavOnScroll';
import { fetchPortfolioSnapshots, saveDailyPortfolioSnapshot } from '../utils/portfolioSnapshots';
import {
  actualizacionCercaDelCierre,
  actualizacionPosteriorAlCierre,
  esDespuesDelCierre,
  esMercadoAbierto,
  fechaMercadoKey,
} from '../utils/marketHours';
import './Home.css';

const MS_POR_MINUTO = 60 * 1000;

const msHastaProximoMinuto = (date = new Date()) => {
  const transcurrido = date.getSeconds() * 1000 + date.getMilliseconds();
  return transcurrido === 0 ? MS_POR_MINUTO : MS_POR_MINUTO - transcurrido;
};

const handleLogout = async () => {
  sessionStorage.removeItem('bioUnlocked');
  await signOut(auth);
};

const KICKER = "font-mono text-[12px] tracking-[0.22em] uppercase text-teal-400 flex items-center gap-1.5";

function PortfolioSparkline({ rows }) {
  if (rows.length === 0) return null;

  const width = 420;
  const height = 96;
  const pad = 10;
  const values = rows.map((row) => row.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = rows.map((row, index) => {
    const x = rows.length === 1 ? width / 2 : pad + (index * (width - pad * 2)) / (rows.length - 1);
    const y = height - pad - ((row.value - min) / range) * (height - pad * 2);
    return { ...row, x, y };
  });
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-sparkline" role="img" aria-label="Evolucion de la cartera">
      {[0, 1, 2].map((tick) => {
        const y = pad + tick * ((height - pad * 2) / 2);
        return <line key={tick} x1={pad} x2={width - pad} y1={y} y2={y} stroke="rgba(45,212,191,0.08)" strokeWidth="1" />;
      })}
      <path d={line} fill="none" stroke="#2DD4BF" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((point) => (
        <circle key={point.date} cx={point.x} cy={point.y} r="4" fill="#080F12" stroke="#FBBF24" strokeWidth="2">
          <title>{`${point.date}: US$ ${point.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export default function Home() {
  const [brokerData, setBrokerData] = useState(() => createEmptyBrokerData());
  const [loading, setLoading] = useState(true);
  const [updatingPrices, setUpdatingPrices] = useState(false);
  const [latestGlobalUpdate, setLatestGlobalUpdate] = useState('');
  const [mep, setMep] = useState(null);
  const [cable, setCable] = useState(null);
  const [riskCountry, setRiskCountry] = useState(null);
  const [tickerTape, setTickerTape] = useState([]);
  const [portfolioSnapshots, setPortfolioSnapshots] = useState([]);
  const [mercadoAbierto, setMercadoAbierto] = useState(() => esMercadoAbierto());
  const bottomNavHidden = useHideBottomNavOnScroll();

  const fetchBalancesRef = useRef(null);

  const parseNum = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    return Number(val.toString().replace(/\./g, '').replace(',', '.')) || 0;
  };

  const refreshSnapshotHistory = async () => {
    try {
      const rows = await fetchPortfolioSnapshots();
      setPortfolioSnapshots(rows);
      return rows;
    } catch (err) {
      console.warn('[Home] Historial cartera:', err.message);
      return [];
    }
  };

  const fetchBalances = async () => {
    try {
      if (!getMepRate() || !getCclRate()) {
        try {
          await fetchAllPrices();
        } catch (err) {
          console.warn('[Home] Cotizaciones MEP/Cable:', err.message);
        }
      }
      const querySnapshot = await getDocs(collection(db, 'brokerPositions'));
      const newBrokerData = createEmptyBrokerData();
      let latestTimestamp = 0;
      const heldTickers = new Set();

      querySnapshot.forEach((document) => {
        const data = document.data();
        const rate = isUsdBroker(document.id) ? 1 : (parseNum(data.usdRate) || 1);
        const assetsTotal = (data.assets || []).reduce((sum, a) => {
          const bond = a.isBond || isBondTicker(a.ticker);
          const divisor = bond ? 100 : 1;
          return sum + (parseNum(a.quantity) * parseNum(a.price)) / divisor / rate;
        }, 0);
        (data.assets || []).forEach((asset) => {
          const ticker = asset.ticker?.toUpperCase().trim();
          if (ticker && !isBondTicker(ticker)) heldTickers.add(ticker);
        });
        const debt = parseNum(data.debt) || 0;
        newBrokerData[document.id] = {
          balance: assetsTotal - debt,
          assetsTotal,
          debt,
          updated: data.lastUpdated ? new Date(data.lastUpdated) : null,
        };
        if (data.lastUpdated) {
          const ts = new Date(data.lastUpdated).getTime();
          if (ts > latestTimestamp) latestTimestamp = ts;
        }
      });

      setBrokerData(newBrokerData);
      setMep(getMepRate());
      setCable(getCclRate());
      refreshSnapshotHistory();
      fetchRiskCountry()
        .then(setRiskCountry)
        .catch((err) => console.warn('[Home] Riesgo pais:', err.message));
      const priceMeta = getPriceMeta();
      setTickerTape(
        [...heldTickers]
          .map((ticker) => ({ ticker, changePercent: priceMeta[ticker]?.changePercent }))
          .filter((item) => item.changePercent !== null && item.changePercent !== undefined)
          .sort((a, b) => a.changePercent - b.changePercent)
      );

      if (latestTimestamp > 0) {
        const d = new Date(latestTimestamp);
        setLatestGlobalUpdate(
          `Act: ${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} hs`
        );
      } else {
        setLatestGlobalUpdate('Sin registros');
      }
      return latestTimestamp;
    } catch (e) {
      console.error('[fetchBalances]', e);
      return 0;
    } finally {
      setLoading(false);
    }
  };

  fetchBalancesRef.current = fetchBalances;

  const handleUpdatePrices = async (silencioso = false, options = {}) => {
    const ahora = new Date();
    if (!esMercadoAbierto(ahora)) {
      setMercadoAbierto(false);
      const latestTimestamp = await fetchBalancesRef.current();
      const yaActualizoPostCierre = actualizacionPosteriorAlCierre(latestTimestamp, ahora);
      const puedeTomarFotoCierre = options.allowClosedRefresh && !yaActualizoPostCierre;

      if (!puedeTomarFotoCierre) {
        if (!silencioso) {
          const mensaje = yaActualizoPostCierre
            ? 'Mercado cerrado: los precios ya fueron actualizados después del cierre. Se volverán a actualizar cuando abra el mercado.'
            : 'Mercado cerrado: no se actualizan precios fuera de 10:30 a 17:00 hs.';
          alert(mensaje);
        }
        return false;
      }
    }

    if (!silencioso) setUpdatingPrices(true);
    try {
      const priceMap = await fetchAllPrices();
      const mepRate = getMepRate();
      const refreshHasMarketData = Object.keys(priceMap).length > 0 || mepRate !== null;
      const querySnapshot = await getDocs(collection(db, 'brokerPositions'));
      const nowIso = new Date().toISOString();

      for (const document of querySnapshot.docs) {
        const data = document.data();
        const isJPM = isUsdBroker(document.id);
        const payload = {};

        const updatedAssets = (data.assets || []).map(a => {
          if (!a.ticker) return a;
          const t = a.ticker.toUpperCase().trim();
          const newPrice = getBrokerLivePrice(t, priceMap, { isUSD: isJPM, mepRate });
          let bond = isBondTicker(t);
          if (!bond && a.isBond) bond = true;

          if (newPrice !== undefined) {
            if (Math.abs(parseNum(a.price) - newPrice) > 0.001 || a.isBond !== bond) {
              payload.assets = true;
              return { ...a, price: newPrice, isBond: bond };
            }
          } else if (bond !== a.isBond) {
            payload.assets = true;
            return { ...a, isBond: bond };
          }
          return a;
        });

        if (payload.assets) payload.assets = updatedAssets;
        else delete payload.assets;

        if (!isJPM && mepRate !== null) payload.usdRate = mepRate;

        if (Object.keys(payload).length > 0 || refreshHasMarketData) {
          payload.lastUpdated = nowIso;
          await updateDoc(doc(db, 'brokerPositions', document.id), payload);
        }
      }
      await fetchBalancesRef.current();
      if (options.captureSnapshot) {
        await saveDailyPortfolioSnapshot({
          source: options.snapshotSource || 'post-close',
          refreshPrices: false,
        });
        await refreshSnapshotHistory();
      }
      return true;
    } catch (error) {
      if (!silencioso) alert(`Error al actualizar: ${error.message}`);
      else console.error('[auto-refresh] Error:', error.message);
      return false;
    } finally {
      if (!silencioso) setUpdatingPrices(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      const abierto = esMercadoAbierto();
      setMercadoAbierto(abierto);
      if (abierto) {
        await handleUpdatePrices(true);
      } else {
        const latestTimestamp = await fetchBalancesRef.current();
        const ahora = new Date();
        const closeRefreshKey = `close-refresh:${fechaMercadoKey(ahora)}`;
        const necesitaFotoCierre =
          esDespuesDelCierre(ahora) &&
          !actualizacionPosteriorAlCierre(latestTimestamp, ahora) &&
          !actualizacionCercaDelCierre(latestTimestamp, ahora) &&
          sessionStorage.getItem(closeRefreshKey) !== 'done';

        if (necesitaFotoCierre) {
          const updated = await handleUpdatePrices(true, {
            allowClosedRefresh: true,
            captureSnapshot: true,
            snapshotSource: 'post-close',
          });
          if (updated) sessionStorage.setItem(closeRefreshKey, 'done');
        } else if (
          esDespuesDelCierre(ahora) &&
          sessionStorage.getItem(closeRefreshKey) !== 'done' &&
          (actualizacionPosteriorAlCierre(latestTimestamp, ahora) || actualizacionCercaDelCierre(latestTimestamp, ahora))
        ) {
          await saveDailyPortfolioSnapshot({
            source: actualizacionPosteriorAlCierre(latestTimestamp, ahora) ? 'post-close' : 'near-close',
            refreshPrices: false,
          });
          await refreshSnapshotHistory();
          sessionStorage.setItem(closeRefreshKey, 'done');
        }
      }
    };
    init();
    const estadoMercado = setInterval(() => {
      setMercadoAbierto(esMercadoAbierto());
    }, 30 * 1000);

    let refreshTimer = null;
    let refreshActivo = true;
    const programarProximoRefresh = () => {
      refreshTimer = setTimeout(async () => {
        if (!refreshActivo) return;
        const abierto = esMercadoAbierto();
        setMercadoAbierto(abierto);
        if (abierto) await handleUpdatePrices(true);
        if (refreshActivo) programarProximoRefresh();
      }, msHastaProximoMinuto());
    };

    programarProximoRefresh();

    return () => {
      refreshActivo = false;
      clearInterval(estadoMercado);
      clearTimeout(refreshTimer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const formatSubDate = (date) => {
    if (!date) return 'Sin datos';
    return (
      date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) +
      ' ' +
      date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) +
      ' hs'
    );
  };

  const brokers = BROKERS.map((broker) => ({ ...broker, ...brokerData[broker.id] }));

  const tickerTapeItems = tickerTape.length > 0 ? [...tickerTape, ...tickerTape] : [];

  const totalActivos = brokers.reduce((sum, b) => sum + (b.assetsTotal || 0), 0);
  const totalDeuda   = brokers.reduce((sum, b) => sum + (b.debt || 0), 0);
  const totalNeto    = brokers.reduce((sum, b) => sum + b.balance, 0);
  const todayKey = fechaMercadoKey(new Date());
  const previousSnapshot = [...portfolioSnapshots]
    .reverse()
    .find((snapshot) => snapshot.date < todayKey) || null;
  const latestSnapshot = portfolioSnapshots[portfolioSnapshots.length - 1] || null;
  const comparisonSnapshot = previousSnapshot || latestSnapshot;
  const dailyDeltaUsd = comparisonSnapshot ? totalNeto - (comparisonSnapshot.totals?.netUsd || 0) : null;
  const dailyDeltaPct = comparisonSnapshot && comparisonSnapshot.totals?.netUsd
    ? (dailyDeltaUsd / comparisonSnapshot.totals.netUsd) * 100
    : null;
  const sparkRows = portfolioSnapshots
    .slice(-9)
    .map((snapshot) => ({ date: snapshot.date, value: snapshot.totals?.netUsd || 0 }));
  const hasTodayInSpark = sparkRows.some((row) => row.date === todayKey);
  const sparklineRows = totalNeto > 0 && !hasTodayInSpark
    ? [...sparkRows, { date: todayKey, value: totalNeto }]
    : sparkRows;
  const cableVsMep = mep > 0 && cable > 0 ? ((cable / mep) - 1) * 100 : null;
  const formatUsdSigned = (value) => {
    if (value === null || value === undefined) return 'Sin historial';
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    return `${sign}US$ ${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  };
  const formatPctSigned = (value) => (
    value !== null && value !== undefined
      ? `${value > 0 ? '+' : ''}${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
      : 'Sin datos'
  );
  const formatFxRate = (value) =>
    value > 0 ? `$ ${value.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : 'Sin datos';
  const formatCableVsMep = (value) =>
    value !== null
      ? `${value > 0 ? '+' : ''}${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
      : 'Sin datos';
  const riskCountryDirection =
    riskCountry?.change > 0 ? 'up' : riskCountry?.change < 0 ? 'down' : 'flat';

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen bg-[#080F12]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-[#1e3040] border-t-teal-400 rounded-full animate-spin" />
        <p className="font-mono text-[13px] tracking-[0.22em] uppercase text-[#5B8A8A] animate-pulse">Cargando Portfolio...</p>
      </div>
    </div>
  );

  return (
    <div className="h-page relative">
      <div className="pointer-events-none absolute top-[-150px] right-[-200px] w-[600px] h-[500px] rounded-full bg-teal-400/[0.04] blur-[100px]" />

      {/* Header */}
      <div className="h-header flex justify-between items-center mb-5 relative z-10">
        <div>
          <p className={KICKER}>
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2DD4BF]" />
            Portfolio Manager
          </p>
          <h2 className="h-page-name text-3xl font-black tracking-tight text-[#F0FAFA] mt-0.5">Marcos</h2>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <div className={`h-market-status ${mercadoAbierto ? 'is-live' : 'is-closed'}`}>
            <span className="h-market-dot" />
            <span>{mercadoAbierto ? 'En vivo' : 'Mercado cerrado'}</span>
          </div>
          <button
            onClick={() => handleUpdatePrices(false)}
            disabled={updatingPrices}
            className="w-10 h-10 rounded-xl bg-[#122329] border border-teal-400/15 hover:border-teal-400/30 flex items-center justify-center text-teal-400 transition-colors disabled:opacity-50"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={updatingPrices ? 'animate-spin' : ''}>
              <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
            </svg>
          </button>
          <Link
            to="/evolucion"
            className="w-10 h-10 rounded-xl bg-[#122329] border border-teal-400/15 hover:border-teal-400/30 flex items-center justify-center text-teal-400 transition-colors"
            title="Evolución"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l6-6 4 4 8-8"/>
              <path d="M14 7h7v7"/>
            </svg>
          </Link>
          <div className="w-10 h-10 rounded-xl bg-teal-400 flex items-center justify-center text-[#080F12] font-black text-sm">M</div>
        </div>
      </div>

      {/* Summary card */}
      <div className="h-summary-card bg-[#122329] border border-teal-400/20 rounded-2xl mb-5 relative overflow-hidden shadow-[0_20px_40px_rgba(0,0,0,0.3)]">
        <div className="pointer-events-none absolute top-[-60px] right-[-60px] w-[250px] h-[250px] rounded-full bg-teal-400/[0.06] blur-[60px]" />

        <div className="h-summary-main p-5 relative z-10">
          <p className={`${KICKER} mb-3`}>
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2DD4BF]" />
            Balance Neto Consolidado
          </p>
          <div className="flex items-baseline gap-2">
            <span className="h-total-amount-prefix text-lg text-[#A8C8C8] font-mono">US$</span>
            <span className="h-total-amount font-black tracking-tight text-[#F0FAFA]">
              {totalNeto.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className="h-last-update font-mono text-[12px] tracking-[0.12em] uppercase text-[#A8C8C8] mt-2">
            {latestGlobalUpdate}
          </div>
          {comparisonSnapshot && (
            <div className="h-daily-change mt-3">
              <span className="h-daily-label">vs {comparisonSnapshot.date}</span>
              <span className={`h-daily-value ${dailyDeltaUsd >= 0 ? 'is-up' : 'is-down'}`}>
                {formatUsdSigned(dailyDeltaUsd)} · {formatPctSigned(dailyDeltaPct)}
              </span>
            </div>
          )}
        </div>

        <div className="h-summary-stats border-t border-teal-400/10 px-5 py-4 grid grid-cols-2 gap-4">
          <div>
            <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A] mb-1">Total Activos</div>
            <div className="h-summary-sub-amount font-bold text-[#F0FAFA]">
              US$ {totalActivos.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div className="h-summary-stats-debt">
            <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-red-400/70 mb-1">Deuda / Caución</div>
            <div className="h-summary-sub-amount font-bold text-red-400">
              - US$ {totalDeuda.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div>
            <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A] mb-1">Dólar MEP</div>
            <div className={`font-bold ${mep > 0 ? 'text-[#F0FAFA]' : 'text-[#5B8A8A]'}`}>{formatFxRate(mep)}</div>
          </div>
          <div>
            <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A] mb-1">Dólar Cable</div>
            <div className={`font-bold ${cable > 0 ? 'text-[#F0FAFA]' : 'text-[#5B8A8A]'}`}>{formatFxRate(cable)}</div>
          </div>
          <div>
            <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A] mb-1">Cable vs MEP</div>
            <div className={`font-bold ${cableVsMep !== null ? 'text-[#F0FAFA]' : 'text-[#5B8A8A]'}`}>
              {formatCableVsMep(cableVsMep)}
            </div>
          </div>
          {riskCountry?.value !== null && riskCountry?.value !== undefined && (
            <div>
              <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A] mb-1">Riesgo País</div>
              <div className="h-risk-country">
                <span className="font-bold text-[#F0FAFA]">
                  {riskCountry.value.toLocaleString('es-AR', { maximumFractionDigits: 0 })} pts
                </span>
                {riskCountry.change !== null && (
                  <span className={`h-risk-change h-risk-${riskCountryDirection}`}>
                    {riskCountry.change > 0 ? '+' : ''}
                    {riskCountry.change.toLocaleString('es-AR', { maximumFractionDigits: 0 })} pts
                    {riskCountry.changePercent !== null && (
                      <> ({riskCountry.changePercent > 0 ? '+' : ''}{riskCountry.changePercent.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%)</>
                    )}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {sparklineRows.length > 0 && (
        <Link to="/evolucion" className="h-evolution-card relative z-10">
          <div className="h-evolution-head">
            <div>
              <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A]">Evolución USD</div>
              <div className="h-evolution-title">Cartera diaria</div>
            </div>
            <div className={`h-evolution-change ${dailyDeltaUsd === null || dailyDeltaUsd >= 0 ? 'is-up' : 'is-down'}`}>
              {dailyDeltaUsd === null ? 'Sin base' : formatPctSigned(dailyDeltaPct)}
            </div>
          </div>
          <PortfolioSparkline rows={sparklineRows} />
          <div className="h-evolution-foot">
            <span>{sparklineRows[0]?.date}</span>
            <span>{sparklineRows[sparklineRows.length - 1]?.date}</span>
          </div>
        </Link>
      )}

      {tickerTapeItems.length > 0 && (
        <div className="h-ticker-tape relative z-10">
          <div className="h-ticker-label">Mercado</div>
          <div className="h-ticker-viewport">
            <div className="h-ticker-track">
              {tickerTapeItems.map((item, index) => {
                const positive = item.changePercent > 0;
                const neutral = item.changePercent === 0;
                return (
                  <div key={`${item.ticker}-${index}`} className="h-ticker-item">
                    <span className="h-ticker-symbol">{item.ticker}</span>
                    <span className={positive ? 'h-ticker-up' : neutral ? 'h-ticker-flat' : 'h-ticker-down'}>
                      {positive ? '+' : ''}{item.changePercent.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Brokers section */}
      <p className={`${KICKER} mb-3`}>
        <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2DD4BF]" />
        <span className="h-section-title">Composición por Broker</span>
      </p>

      <div className="h-broker-grid">
        {brokers.map(b => {
          const percentage = totalNeto > 0 ? ((b.balance / totalNeto) * 100).toFixed(1) : 0;
          const debtPct = b.assetsTotal > 0 ? (b.debt / b.assetsTotal) * 100 : 0;
          const balanceCCL = b.id === 'jpm' && mep > 0 && cable > 0
            ? b.balance * mep / cable
            : null;

          return (
            <Link key={b.id} to={`/broker/${b.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
              <div className="h-broker-card bg-[#122329] border border-teal-400/10 hover:border-teal-400/25 rounded-2xl transition-colors">
                <div className="h-card-inner">
                  <div className="h-card-left flex items-center gap-3">
                    <div className="h-card-logo-wrap rounded-xl flex items-center justify-center shrink-0">
                      <img
                        src={b.logo}
                        alt={`${b.name} logo`}
                        className="h-broker-logo"
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.parentNode.innerHTML = `<span style="font-weight:900;color:#122329;font-size:11px;">${b.name.substring(0, 3).toUpperCase()}</span>`;
                        }}
                      />
                    </div>
                    <div>
                      <div className="h-broker-name font-bold text-[#F0FAFA]">{b.name}</div>
                      <div className="h-broker-date font-mono text-[12px] text-[#5B8A8A] mt-0.5">{formatSubDate(b.updated)}</div>
                    </div>
                  </div>

                  <div className="h-card-right">
                    <div className="h-balance font-black text-teal-400">
                      US$ {b.balance.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </div>
                    {balanceCCL !== null && (
                      <div className="h-cable-val font-mono text-[#5B8A8A]">
                        Cable US$ {balanceCCL.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </div>
                    )}
                    {b.debt > 0 && (
                      <div className="h-cable-val font-mono text-red-400">
                        Deuda US$ {b.debt.toLocaleString('en-US', { maximumFractionDigits: 0 })} ({debtPct.toFixed(1)}%)
                      </div>
                    )}
                    <div className="h-broker-pct font-mono text-teal-400/60">
                      {percentage}%
                    </div>
                  </div>
                </div>

                <div className="h-progress-track bg-[#0C1518] rounded-full overflow-hidden">
                  <div style={{ width: `${percentage}%`, height: '100%', backgroundColor: 'rgba(45,212,191,0.4)', borderRadius: '9999px' }} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Bottom nav */}
      <div className={`h-bottomnav bg-[#0C1518] border-t border-teal-400/10 ${bottomNavHidden ? 'is-hidden' : ''}`}>
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#2DD4BF', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Brokers</span>
        </Link>
        <Link to="/unificada" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Cartera</span>
        </Link>
        <Link to="/precios" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 15l3-3 3 2 5-7"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Precios</span>
        </Link>
        <Link to="/maximos" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Maximos</span>
        </Link>
        <Link to="/rotaciones" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="18" y="3" width="4" height="18"/><rect x="10" y="8" width="4" height="13"/><rect x="2" y="13" width="4" height="8"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Estrategias</span>
        </Link>
        <button onClick={handleLogout} style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1, cursor: 'pointer', padding: 0 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Salir</span>
        </button>
      </div>
    </div>
  );
}
