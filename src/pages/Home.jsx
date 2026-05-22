import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { db, auth } from '../firebase/config';
import { fetchAllPrices, getMepRate, getCclRate, isBondTicker } from '../utils/priceService';
import './Home.css';

const handleLogout = async () => {
  sessionStorage.removeItem('bioUnlocked');
  await signOut(auth);
};

export default function Home() {
  const [brokerData, setBrokerData] = useState({
    jpm: { balance: 0, assetsTotal: 0, debt: 0, updated: null },
    one: { balance: 0, assetsTotal: 0, debt: 0, updated: null },
    latin: { balance: 0, assetsTotal: 0, debt: 0, updated: null }
  });
  const [loading, setLoading] = useState(true);
  const [updatingPrices, setUpdatingPrices] = useState(false);
  const [latestGlobalUpdate, setLatestGlobalUpdate] = useState('');

  const parseNum = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    return Number(val.toString().replace(/\./g, '').replace(',', '.')) || 0;
  };

  useEffect(() => {
    const fetchBalances = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "brokerPositions"));
        const newBrokerData = {
          jpm: { balance: 0, assetsTotal: 0, debt: 0, updated: null },
          one: { balance: 0, assetsTotal: 0, debt: 0, updated: null },
          latin: { balance: 0, assetsTotal: 0, debt: 0, updated: null }
        };
        let latestTimestamp = 0;

        querySnapshot.forEach((document) => {
          const data = document.data();
          const rate = (document.id === 'jpm') ? 1 : (parseNum(data.usdRate) || 1);

          const assetsTotal = (data.assets || []).reduce((sum, a) => {
            const isBond = a.isBond || isBondTicker(a.ticker);
            const divisor = isBond ? 100 : 1;
            return sum + ((parseNum(a.quantity) * parseNum(a.price)) / divisor / rate);
          }, 0);

          const debt = parseNum(data.debt) || 0;
          const total = assetsTotal - debt;

          newBrokerData[document.id] = {
            balance: total,
            assetsTotal: assetsTotal,
            debt: debt,
            updated: data.lastUpdated ? new Date(data.lastUpdated) : null
          };

          if (data.lastUpdated) {
            const docDate = new Date(data.lastUpdated).getTime();
            if (docDate > latestTimestamp) latestTimestamp = docDate;
          }
        });

        setBrokerData(newBrokerData);

        if (latestTimestamp > 0) {
          const d = new Date(latestTimestamp);
          setLatestGlobalUpdate(`Act: ${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} hs`);
        } else {
          setLatestGlobalUpdate('Sin registros de actualización');
        }
      } catch (e) {
      } finally {
        setLoading(false);
      }
    };

    const init = async () => {
      try { await fetchAllPrices(); } catch (e) {}
      fetchBalances();
    };

    init();
  }, []);

  const handleUpdatePrices = async () => {
    setUpdatingPrices(true);
    try {
      const priceMap = await fetchAllPrices();
      const mepRate = getMepRate();
      const querySnapshot = await getDocs(collection(db, "brokerPositions"));
      const nowIso = new Date().toISOString();

      for (const document of querySnapshot.docs) {
        const data = document.data();
        const isJPM = document.id === 'jpm';
        const payload = {};

        const updatedAssets = (data.assets || []).map(a => {
          if (!a.ticker) return a;
          const t = a.ticker.toUpperCase().trim();
          let newPrice = priceMap[t];
            if (newPrice !== undefined) console.log(`✅ ${document.id} | ${t}: ${a.price} → ${newPrice.toFixed(4)}`);
  else console.warn(`❌ ${document.id} | ${t}: sin precio en BYMA`);
          let isBond = isBondTicker(t);
          if (!isBond && a.isBond) isBond = true;

          if (newPrice !== undefined) {
            if (isJPM && mepRate > 0) newPrice = newPrice / mepRate;
            if (Math.abs(parseNum(a.price) - newPrice) > 0.001 || a.isBond !== isBond) {
              payload.assets = true;
              return { ...a, price: newPrice, isBond };
            }
          } else if (isBond !== a.isBond) {
            payload.assets = true;
            return { ...a, isBond };
          }
          return a;
        });

        if (payload.assets) payload.assets = updatedAssets;
        else delete payload.assets;

        if (!isJPM && mepRate !== null) payload.usdRate = mepRate;

        if (Object.keys(payload).length > 0) {
          payload.lastUpdated = nowIso;
          await updateDoc(doc(db, "brokerPositions", document.id), payload);
        }
      }

      window.location.reload();
    } catch (error) {
      alert(`Error al actualizar: ${error.message}`);
      setUpdatingPrices(false);
    }
  };

  const formatSubDate = (date) => {
    if (!date) return 'Sin datos';
    return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
      + ' ' + date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + ' hs';
  };

  const brokers = [
    { id: 'jpm',   name: 'J.P. Morgan',      ...brokerData.jpm,   logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/af/J_P_Morgan_Chase_Logo_2008_1.svg/512px-J_P_Morgan_Chase_Logo_2008_1.svg.png' },
    { id: 'one',   name: 'One618',            ...brokerData.one,   logo: 'https://play-lh.googleusercontent.com/rmyAkju1LNJl3AEF4cN2ef4jGxzmiSfxga17vLkwPDc-nyDkkxP78TEoKj1cxF_xGtLHBs6BWb0ccR5WvhCj' },
    { id: 'latin', name: 'Latin Securities',  ...brokerData.latin, logo: 'https://reqlut2.s3.amazonaws.com/uploads/logos/420d0b715847860c019e638a3c54fa61864f5665-5242880.png' }
  ];

  const totalActivos = brokers.reduce((sum, b) => sum + (b.assetsTotal || 0), 0);
  const totalDeuda   = brokers.reduce((sum, b) => sum + (b.debt || 0), 0);
  const totalNeto    = brokers.reduce((sum, b) => sum + b.balance, 0);

  if (loading) return <div style={{ padding: '50px', textAlign: 'center', fontWeight: 800, color: '#adb5bd' }}>Cargando Portfolio...</div>;

  const mepRate = getMepRate();
  const cclRate = getCclRate();

  return (
    <div className="h-page">

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <div>
          <div className="h-page-label" style={{ fontSize: '12px', fontWeight: 800, color: '#adb5bd', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Portfolio Manager
          </div>
          <h2 className="h-page-name" style={{ fontSize: '28px', fontWeight: 900, margin: '4px 0 0 0', color: '#1a1d21' }}>
            Marcos
          </h2>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={handleUpdatePrices}
            disabled={updatingPrices}
            style={{ width: '42px', height: '42px', borderRadius: '50%', backgroundColor: 'white', border: '1px solid #eaecef', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', color: updatingPrices ? '#adb5bd' : '#0d6efd', boxShadow: '0 4px 10px rgba(0,0,0,0.02)', cursor: 'pointer' }}
          >
            {updatingPrices ? '...' : '🔄'}
          </button>
          <div style={{ width: '42px', height: '42px', borderRadius: '50%', backgroundColor: '#1a1d21', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 800, color: 'white', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>
            M
          </div>
        </div>
      </div>

      {/* ── Summary dark card ── */}
      <div className="h-summary-card" style={{ padding: '30px 25px', background: 'linear-gradient(135deg, #111418 0%, #2b3036 100%)', borderRadius: '32px', marginBottom: '35px', color: 'white', boxShadow: '0 15px 30px rgba(0,0,0,0.12)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-20px', right: '-20px', width: '200px', height: '200px', background: 'radial-gradient(circle, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 70%)', borderRadius: '50%' }} />

        {/* Main section: label + number */}
        <div className="h-summary-main">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="h-summary-label" style={{ fontSize: '12px', fontWeight: 600, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '10px' }}>
              Balance Neto Consolidado
            </div>
            <div className="h-summary-date" style={{ fontSize: '10px', fontWeight: 700, backgroundColor: 'rgba(255,255,255,0.1)', padding: '4px 10px', borderRadius: '8px', whiteSpace: 'nowrap' }}>
              {latestGlobalUpdate}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span className="h-total-amount-prefix" style={{ fontSize: '24px', opacity: 0.8, marginRight: '6px' }}>US$</span>
            <span className="h-total-amount" style={{ fontSize: '46px', fontWeight: 900, letterSpacing: '-1px' }}>
              {totalNeto.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>

        {/* Stats section */}
        <div className="h-summary-stats" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '15px', marginTop: '20px' }}>
          <div>
            <div className="h-summary-sub-label" style={{ fontSize: '10px', fontWeight: 600, color: '#adb5bd', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>Total Activos</div>
            <div className="h-summary-sub-amount" style={{ fontSize: '18px', fontWeight: 800 }}>
              US$ {totalActivos.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div className="h-summary-stats-debt">
            <div className="h-summary-sub-label" style={{ fontSize: '10px', fontWeight: 600, color: '#ff453a', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>Deuda / Caución</div>
            <div className="h-summary-sub-amount" style={{ fontSize: '18px', fontWeight: 800, color: '#ff453a' }}>
              - US$ {totalDeuda.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Brokers section ── */}
      <h3 className="h-section-title" style={{ fontSize: '18px', fontWeight: 800, color: '#1a1d21', margin: '0 0 15px 5px' }}>
        Composición por Broker
      </h3>

      <div className="h-broker-grid">
        {brokers.map(b => {
          const percentage = totalNeto > 0 ? ((b.balance / totalNeto) * 100).toFixed(1) : 0;
          const balanceCCL = b.id === 'jpm' && mepRate > 0 && cclRate > 0
            ? b.balance * mepRate / cclRate
            : null;

          return (
            <Link key={b.id} to={`/broker/${b.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
              <div className="h-broker-card" style={{ padding: '22px', backgroundColor: 'white', borderRadius: '24px', border: '1px solid #eaecef', boxShadow: '0 6px 16px rgba(0,0,0,0.02)', height: '100%', boxSizing: 'border-box' }}>

                <div className="h-card-inner">
                  {/* Logo + Name */}
                  <div className="h-card-left" style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div className="h-card-logo-wrap">
                      <img
                        src={b.logo}
                        alt={`${b.name} logo`}
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.parentNode.innerHTML = `<span style="font-weight:900;color:#1a1d21;font-size:14px;">${b.name.substring(0, 3).toUpperCase()}</span>`;
                        }}
                      />
                    </div>
                    <div>
                      <div className="h-broker-name" style={{ fontSize: '16px', fontWeight: 800, color: '#1a1d21' }}>{b.name}</div>
                      <div className="h-broker-date" style={{ fontSize: '11px', color: '#adb5bd', fontWeight: 600, marginTop: '2px' }}>{formatSubDate(b.updated)}</div>
                    </div>
                  </div>

                  {/* Balance + CCL + % */}
                  <div className="h-card-right">
                    <div className="h-balance" style={{ fontSize: '18px', fontWeight: 900, color: '#1a1d21' }}>
                      US$ {b.balance.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </div>
                    {balanceCCL !== null && (
                      <div className="h-cable-val" style={{ fontSize: '11px', fontWeight: 800, color: '#6c757d', marginTop: '1px' }}>
                        Cable US$ {balanceCCL.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </div>
                    )}
                    <div className="h-broker-pct" style={{ fontSize: '12px', fontWeight: 800, color: '#0d6efd', marginTop: '2px' }}>
                      {percentage}%
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-progress-track">
                  <div style={{ width: `${percentage}%`, height: '100%', backgroundColor: '#1a1d21', borderRadius: '3px' }} />
                </div>

              </div>
            </Link>
          );
        })}
      </div>

      {/* ── Bottom nav ── */}
      <div className="h-bottomnav">
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#1a1d21', flex: 1 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span style={{ fontSize: '11px', fontWeight: 800 }}>Brokers</span>
        </Link>
        <Link to="/unificada" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#adb5bd', flex: 1 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
          <span style={{ fontSize: '11px', fontWeight: 800 }}>Cartera</span>
        </Link>
        <Link to="/rotaciones" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#adb5bd', flex: 1 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="18" y="3" width="4" height="18"/><rect x="10" y="8" width="4" height="13"/><rect x="2" y="13" width="4" height="8"/></svg>
          <span style={{ fontSize: '11px', fontWeight: 800 }}>Estrategias</span>
        </Link>
        <button onClick={handleLogout} style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#adb5bd', flex: 1, cursor: 'pointer', padding: 0 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span style={{ fontSize: '11px', fontWeight: 800 }}>Salir</span>
        </button>
      </div>

    </div>
  );
}
