import { useState, useEffect } from 'react';
import { collection, getDocs, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Link } from 'react-router-dom';
import { fetchAllPrices, getMepRate } from '../utils/priceService';

export default function Dashboard() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingPrices, setUpdatingPrices] = useState(false);

  const parseNum = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    return Number(val.toString().replace(/\./g, '').replace(',', '.')) || 0;
  };

  const fetchEvents = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "rotations"));
      let data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => {
        if (a.isClosed === b.isClosed) return new Date(b.tradeDate) - new Date(a.tradeDate);
        return a.isClosed ? 1 : -1;
      });
      setEvents(data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => { fetchEvents(); }, []);

  const handleDelete = async (e, id) => {
    e.preventDefault(); e.stopPropagation();
    if (window.confirm("¿Estás seguro de eliminar esta operación?")) {
      try {
        await deleteDoc(doc(db, "rotations", id));
        setEvents(events.filter(ev => ev.id !== id));
      } catch (err) { alert("Error al borrar."); }
    }
  };

  const handleUpdatePrices = async () => {
    setUpdatingPrices(true);
    try {
      const priceMap = await fetchAllPrices();
      
      const nowIso = new Date().toISOString();
      const timeStr = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

      const rotSnap = await getDocs(collection(db, "rotations"));
      for (const d of rotSnap.docs) {
        const data = d.data();
        if (data.isClosed) continue;
        let changed = false;
        const curP = { ...(data.currentPricesFromDb || {}) };
        const soldP = { ...(data.soldCurrentPricesFromDb || {}) };

        ;(data.boughtAssetsFromDb || data.boughtAssets || []).forEach(a => {
          const t = a.ticker?.toUpperCase().trim();
          if (t && priceMap[t]) { curP[t] = priceMap[t]; changed = true; }
        })
        ;(data.soldAssets || []).forEach(a => {
          const t = a.ticker?.toUpperCase().trim();
          if (t && priceMap[t]) { soldP[t] = priceMap[t]; changed = true; }
        })

        if (changed) await updateDoc(doc(db, "rotations", d.id), { currentPricesFromDb: curP, soldCurrentPricesFromDb: soldP, lastUpdated: timeStr });
      }

      const brokSnap = await getDocs(collection(db, "brokerPositions"));
      for (const d of brokSnap.docs) {
        const data = d.data();
        const updatedAssets = (data.assets || []).map(a => {
          const t = a.ticker?.toUpperCase().trim();
          if (t && priceMap[t]) return { ...a, price: priceMap[t] };
          return a;
        })
        await updateDoc(doc(db, "brokerPositions", d.id), { assets: updatedAssets, lastUpdated: nowIso });
      }

      alert("Sincronización completada.");
      window.location.reload();

    } catch (error) {
      alert("Error: " + error.message);
    } finally {
      setUpdatingPrices(false);
    }
  };

  const exportMaeData = async () => {
    try {
      const maeRes = await fetch('/api/mae/mercado/cotizaciones/rentafija', {
        headers: { 'x-api-key': import.meta.env.VITE_MAE_API_KEY }
      });
      const json = await maeRes.json();
      const lista = json.data || json;

      let csv = "Ticker;Precio Ultimo;Precio Cierre;Variacion;Volumen;Segmento;Descripcion\n";
      lista.forEach(i => {
        csv += `${i.ticker};${i.precioUltimo};${i.precioCierre};${i.variacion};${i.volumenAcumulado};${i.segmento};${i.descripcion}\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'data_mae_completa.csv';
      a.click();
    } catch (error) {
      alert("Error al descargar datos: " + error.message);
    }
  };

  const getBadgeStyle = (val) => ({
    textAlign: 'center', padding: '10px 4px', borderRadius: '14px', border: '1px solid #eee', 
    display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '45px',
    backgroundColor: val > 0.1 ? '#00c805' : val < -0.1 ? '#ff3b30' : '#f8f9fa', 
    color: Math.abs(val) > 0.1 ? 'white' : '#1a1d21'
  });

  if (loading) return <div style={{ padding: '100px 0', textAlign: 'center', fontWeight: 800 }}>Cargando...</div>;

  return (
    <div style={{ padding: '24px 0px', paddingBottom: '100px', maxWidth: '600px', margin: 'auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '26px', fontWeight: 900, margin: 0 }}>Estrategias</h2>
        
        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            onClick={exportMaeData} 
            style={{ 
              height: '40px', padding: '0 12px', borderRadius: '14px', backgroundColor: '#f8f9fa', 
              border: '1px solid #eaecef', fontSize: '13px', fontWeight: 800, color: '#1a1d21', 
              cursor: 'pointer' 
            }}
          >
            📊 MAE CSV
          </button>
          <button 
            onClick={handleUpdatePrices} 
            disabled={updatingPrices}
            style={{ 
              width: '40px', height: '40px', borderRadius: '14px', backgroundColor: 'white', 
              border: '1px solid #eaecef', display: 'flex', alignItems: 'center', justifyContent: 'center', 
              fontSize: '18px', color: updatingPrices ? '#adb5bd' : '#1a1d21', 
              boxShadow: '0 4px 10px rgba(0,0,0,0.02)', cursor: 'pointer' 
            }}
          >
            {updatingPrices ? '...' : '🔄'}
          </button>
          <Link to="/nuevo" style={{ padding: '10px 18px', backgroundColor: '#1a1d21', color: 'white', textDecoration: 'none', borderRadius: '14px', fontSize: '13px', fontWeight: 800, display: 'flex', alignItems: 'center' }}>
            + Nueva
          </Link>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {events.map(event => {
          const soldAssets = event.soldAssets || [];
          const boughtAssets = event.boughtAssetsFromDb || event.boughtAssets || [];
          const currentPrices = event.currentPricesFromDb || {};
          const soldCurrentPrices = event.soldCurrentPricesFromDb || {};
          const initialUsdRate = event.initialUsdRate || 1;
          const currentUsdRate = event.currentUsdRateFromDb || initialUsdRate;

          const totalARS_Init = soldAssets.reduce((sum, a) => sum + (parseNum(a.quantity) * parseNum(a.priceAtTrade)), 0);
          const totalUSD_Init = totalARS_Init / initialUsdRate;
          const totalARS_Now = boughtAssets.reduce((sum, a) => sum + (parseNum(a.quantity) * (currentPrices[a.ticker] || parseNum(a.priceAtTrade) || 0)), 0);
          const totalUSD_Now = totalARS_Now / currentUsdRate;
          const totalARS_Now_Prev = soldAssets.reduce((sum, a) => sum + (parseNum(a.quantity) * (soldCurrentPrices[a.ticker] || parseNum(a.priceAtTrade) || 0)), 0);
          const totalUSD_Now_Prev = totalARS_Now_Prev / currentUsdRate;

          const pUSD = totalUSD_Init > 0 ? ((totalUSD_Now / totalUSD_Init) - 1) * 100 : 0;
          const pARS = totalARS_Init > 0 ? ((totalARS_Now / totalARS_Init) - 1) * 100 : 0;
          const pALFA = totalUSD_Now_Prev > 0 ? ((totalUSD_Now / totalUSD_Now_Prev) - 1) * 100 : 0;

          return (
            <Link key={event.id} to={`/evento/${event.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{ padding: '22px', backgroundColor: 'white', borderRadius: '28px', border: '1px solid #eaecef', position: 'relative', boxShadow: '0 4px 15px rgba(0,0,0,0.03)', opacity: event.isClosed ? 0.7 : 1 }}>
                
                <button onClick={(e) => handleDelete(e, event.id)} style={{ position: 'absolute', top: '20px', right: '20px', border: 'none', background: '#fff0f0', color: '#ff3b30', fontSize: '10px', fontWeight: 800, padding: '6px 12px', borderRadius: '10px', zIndex: 10 }}>BORRAR</button>
                
                <div style={{ marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '19px', fontWeight: 800, margin: '0 0 8px 0', paddingRight: '80px', lineHeight: '1.2' }}>{event.eventName}</h3>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '15px' }}>
                    <span style={{ fontSize: '11px', color: '#6c757d', fontWeight: 800, backgroundColor: '#f0f2f5', padding: '4px 8px', borderRadius: '6px' }}>{event.tradeDate}</span>
                    {event.isClosed && <span style={{ fontSize: '9px', fontWeight: 900, backgroundColor: '#1a1d21', color: 'white', padding: '4px 8px', borderRadius: '6px' }}>CERRADA</span>}
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', backgroundColor: '#fcfcfc', padding: '12px', borderRadius: '16px', border: '1px solid #f8f8f8' }}>
                    <div>
                      <div style={{ fontSize: '9px', fontWeight: 900, color: '#198754', textTransform: 'uppercase' }}>VALOR ACTUAL</div>
                      <div style={{ fontSize: '17px', fontWeight: 900 }}>US$ {totalUSD_Now.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                      <div style={{ fontSize: '11px', color: '#198754', fontWeight: 700 }}>$ {totalARS_Now.toLocaleString('es-AR', {maximumFractionDigits: 0})}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '9px', fontWeight: 900, color: '#adb5bd', textTransform: 'uppercase' }}>INVERTIDO</div>
                      <div style={{ fontSize: '17px', fontWeight: 900, color: '#adb5bd' }}>US$ {totalUSD_Init.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                      <div style={{ fontSize: '11px', color: '#adb5bd', fontWeight: 700 }}>$ {totalARS_Init.toLocaleString('es-AR', {maximumFractionDigits: 0})}</div>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                  <div style={getBadgeStyle(pUSD)}><span style={{ fontSize: '7px', fontWeight: 900 }}>REND. USD</span><div style={{ fontSize: '14px', fontWeight: 900 }}>{pUSD >= 0 ? '+' : ''}{pUSD.toFixed(1)}%</div></div>
                  <div style={getBadgeStyle(pARS)}><span style={{ fontSize: '7px', fontWeight: 900 }}>REND. ARS</span><div style={{ fontSize: '14px', fontWeight: 900 }}>{pARS >= 0 ? '+' : ''}{pARS.toFixed(1)}%</div></div>
                  <div style={getBadgeStyle(pALFA)}><span style={{ fontSize: '7px', fontWeight: 900 }}>ALFA</span><div style={{ fontSize: '14px', fontWeight: 900 }}>{pALFA >= 0 ? '+' : ''}{pALFA.toFixed(1)}%</div></div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '600px', backgroundColor: 'white', display: 'flex', justifyContent: 'space-around', padding: '12px 10px 24px 10px', boxShadow: '0 -4px 20px rgba(0,0,0,0.06)', borderRadius: '24px 24px 0 0', zIndex: 1000, boxSizing: 'border-box' }}>
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#adb5bd', flex: 1 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          <span style={{ fontSize: '11px', fontWeight: 800 }}>Brokers</span>
        </Link>
        <Link to="/unificada" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#adb5bd', flex: 1 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>
          <span style={{ fontSize: '11px', fontWeight: 800 }}>Cartera</span>
        </Link>
        <Link to="/rotaciones" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#1a1d21', flex: 1 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="18" y="3" width="4" height="18"></rect><rect x="10" y="8" width="4" height="13"></rect><rect x="2" y="13" width="4" height="8"></rect></svg>
          <span style={{ fontSize: '11px', fontWeight: 800 }}>Estrategias</span>
        </Link>
      </div>

    </div>
  );
}