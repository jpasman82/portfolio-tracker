import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { db, auth } from '../firebase/config';
import { fetchAllPrices, getMepRate, getCclRate, isBondTicker } from '../utils/priceService';
import './Home.css';

const INTERVALO_MINUTOS = 10;
const HORA_APERTURA = 11;
const HORA_CIERRE = 17;

const handleLogout = async () => {
  sessionStorage.removeItem('bioUnlocked');
  await signOut(auth);
};

function esMercadoAbierto() {
  const ahora = new Date();
  const dia = ahora.getDay();
  const hora = ahora.getHours();
  return dia >= 1 && dia <= 5 && hora >= HORA_APERTURA && hora < HORA_CIERRE;
}

const KICKER = "font-mono text-[12px] tracking-[0.22em] uppercase text-teal-400 flex items-center gap-1.5";

export default function Home() {
  const [brokerData, setBrokerData] = useState({
    jpm:   { balance: 0, assetsTotal: 0, debt: 0, updated: null },
    one:   { balance: 0, assetsTotal: 0, debt: 0, updated: null },
    latin: { balance: 0, assetsTotal: 0, debt: 0, updated: null },
  });
  const [loading, setLoading] = useState(true);
  const [updatingPrices, setUpdatingPrices] = useState(false);
  const [latestGlobalUpdate, setLatestGlobalUpdate] = useState('');
  const [mep, setMep] = useState(null);
  const [cable, setCable] = useState(null);

  const fetchBalancesRef = useRef(null);

  const parseNum = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    return Number(val.toString().replace(/\./g, '').replace(',', '.')) || 0;
  };

  const fetchBalances = async () => {
    try {
      if (!getMepRate()) {
        try { await fetchAllPrices(); } catch (e) {}
      }
      const querySnapshot = await getDocs(collection(db, 'brokerPositions'));
      const newBrokerData = {
        jpm:   { balance: 0, assetsTotal: 0, debt: 0, updated: null },
        one:   { balance: 0, assetsTotal: 0, debt: 0, updated: null },
        latin: { balance: 0, assetsTotal: 0, debt: 0, updated: null },
      };
      let latestTimestamp = 0;

      querySnapshot.forEach((document) => {
        const data = document.data();
        const rate = document.id === 'jpm' ? 1 : (parseNum(data.usdRate) || 1);
        const assetsTotal = (data.assets || []).reduce((sum, a) => {
          const bond = a.isBond || isBondTicker(a.ticker);
          const divisor = bond ? 100 : 1;
          return sum + (parseNum(a.quantity) * parseNum(a.price)) / divisor / rate;
        }, 0);
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

      if (latestTimestamp > 0) {
        const d = new Date(latestTimestamp);
        setLatestGlobalUpdate(
          `Act: ${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} hs`
        );
      } else {
        setLatestGlobalUpdate('Sin registros');
      }
    } catch (e) {
      console.error('[fetchBalances]', e);
    } finally {
      setLoading(false);
    }
  };

  fetchBalancesRef.current = fetchBalances;

  const handleUpdatePrices = async (silencioso = false) => {
    if (!silencioso) setUpdatingPrices(true);
    try {
      const priceMap = await fetchAllPrices();
      const mepRate = getMepRate();
      const querySnapshot = await getDocs(collection(db, 'brokerPositions'));
      const nowIso = new Date().toISOString();

      for (const document of querySnapshot.docs) {
        const data = document.data();
        const isJPM = document.id === 'jpm';
        const payload = {};

        const updatedAssets = (data.assets || []).map(a => {
          if (!a.ticker) return a;
          const t = a.ticker.toUpperCase().trim();
          let newPrice = priceMap[t];
          let bond = isBondTicker(t);
          if (!bond && a.isBond) bond = true;

          if (newPrice !== undefined) {
            if (isJPM && mepRate > 0) newPrice = newPrice / mepRate;
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

        if (Object.keys(payload).length > 0) {
          payload.lastUpdated = nowIso;
          await updateDoc(doc(db, 'brokerPositions', document.id), payload);
        }
      }
      await fetchBalancesRef.current();
    } catch (error) {
      if (!silencioso) alert(`Error al actualizar: ${error.message}`);
      else console.error('[auto-refresh] Error:', error.message);
    } finally {
      if (!silencioso) setUpdatingPrices(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      try { await fetchAllPrices(); } catch (e) {}
      await fetchBalancesRef.current();
    };
    init();
    const intervalo = setInterval(() => {
      if (esMercadoAbierto()) handleUpdatePrices(true);
    }, INTERVALO_MINUTOS * 60 * 1000);
    return () => clearInterval(intervalo);
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

  const brokers = [
    { id: 'jpm',   name: 'J.P. Morgan',     ...brokerData.jpm,   logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/af/J_P_Morgan_Chase_Logo_2008_1.svg/512px-J_P_Morgan_Chase_Logo_2008_1.svg.png' },
    { id: 'one',   name: 'One618',           ...brokerData.one,   logo: 'https://play-lh.googleusercontent.com/rmyAkju1LNJl3AEF4cN2ef4jGxzmiSfxga17vLkwPDc-nyDkkxP78TEoKj1cxF_xGtLHBs6BWb0ccR5WvhCj' },
    { id: 'latin', name: 'Latin Securities', ...brokerData.latin, logo: 'https://reqlut2.s3.amazonaws.com/uploads/logos/420d0b715847860c019e638a3c54fa61864f5665-5242880.png' },
  ];

  const totalActivos = brokers.reduce((sum, b) => sum + (b.assetsTotal || 0), 0);
  const totalDeuda   = brokers.reduce((sum, b) => sum + (b.debt || 0), 0);
  const totalNeto    = brokers.reduce((sum, b) => sum + b.balance, 0);

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
        <div className="flex gap-2">
          <button
            onClick={() => handleUpdatePrices(false)}
            disabled={updatingPrices}
            className="w-10 h-10 rounded-xl bg-[#122329] border border-teal-400/15 hover:border-teal-400/30 flex items-center justify-center text-teal-400 transition-colors disabled:opacity-50"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={updatingPrices ? 'animate-spin' : ''}>
              <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
            </svg>
          </button>
          <div className="w-10 h-10 rounded-xl bg-teal-400 flex items-center justify-center text-[#080F12] font-black text-sm">M</div>
        </div>
      </div>

      {/* Summary card */}
      <div className="h-summary-card bg-[#122329] border border-teal-400/20 rounded-2xl mb-5 relative overflow-hidden shadow-[0_20px_40px_rgba(0,0,0,0.3)]">
        <div className="pointer-events-none absolute top-[-60px] right-[-60px] w-[250px] h-[250px] rounded-full bg-teal-400/[0.06] blur-[60px]" />

        <div className="h-summary-main p-5 relative z-10">
          <div className="flex justify-between items-start mb-3">
            <p className={KICKER}>
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2DD4BF]" />
              Balance Neto Consolidado
            </p>
            <span className="font-mono text-[11px] tracking-[0.12em] uppercase text-[#5B8A8A] bg-[#0C1518] border border-teal-400/10 px-2 py-1 rounded-lg shrink-0 ml-2">
              {latestGlobalUpdate}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="h-total-amount-prefix text-lg text-[#A8C8C8] font-mono">US$</span>
            <span className="h-total-amount font-black tracking-tight text-[#F0FAFA]">
              {totalNeto.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </span>
          </div>
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
          {mep && (
            <div>
              <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A] mb-1">Dólar MEP</div>
              <div className="font-bold text-[#F0FAFA]">$ {mep.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
            </div>
          )}
          {cable && (
            <div>
              <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A] mb-1">Dólar Cable</div>
              <div className="font-bold text-[#F0FAFA]">$ {cable.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
            </div>
          )}
        </div>
      </div>

      {/* Brokers section */}
      <p className={`${KICKER} mb-3`}>
        <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2DD4BF]" />
        <span className="h-section-title">Composición por Broker</span>
      </p>

      <div className="h-broker-grid">
        {brokers.map(b => {
          const percentage = totalNeto > 0 ? ((b.balance / totalNeto) * 100).toFixed(1) : 0;
          const balanceCCL = b.id === 'jpm' && mep > 0 && cable > 0
            ? b.balance * mep / cable
            : null;

          return (
            <Link key={b.id} to={`/broker/${b.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
              <div className="h-broker-card bg-[#122329] border border-teal-400/10 hover:border-teal-400/25 rounded-2xl transition-colors">
                <div className="h-card-inner">
                  <div className="h-card-left flex items-center gap-3">
                    <div className="h-card-logo-wrap bg-[#0C1518] border border-teal-400/10 rounded-xl flex items-center justify-center overflow-hidden shrink-0">
                      <img
                        src={b.logo}
                        alt={`${b.name} logo`}
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.parentNode.innerHTML = `<span style="font-weight:900;color:#A8C8C8;font-size:11px;">${b.name.substring(0, 3).toUpperCase()}</span>`;
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
      <div className="h-bottomnav bg-[#0C1518] border-t border-teal-400/10">
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#2DD4BF', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Brokers</span>
        </Link>
        <Link to="/unificada" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Cartera</span>
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
