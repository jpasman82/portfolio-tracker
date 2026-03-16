import { useState, useEffect } from 'react';
import { collection, getDocs, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

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
    if (window.confirm("¿Eliminar operación?")) {
      try {
        await deleteDoc(doc(db, "rotations", id));
        setEvents(events.filter(ev => ev.id !== id));
      } catch (err) { alert("Error al borrar."); }
    }
  };

  const getBadgeStyle = (val) => ({
    textAlign: 'center', padding: '10px 4px', borderRadius: '14px', border: '1px solid #eee', 
    display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '45px',
    backgroundColor: val > 0.1 ? '#00c805' : val < -0.1 ? '#ff3b30' : '#f8f9fa', 
    color: Math.abs(val) > 0.1 ? 'white' : '#1a1d21'
  });

  if (loading) return <div style={{ padding: '100px 0', textAlign: 'center', fontWeight: 800 }}>Cargando Latinbonos...</div>;

  return (
    <div style={{ padding: '24px 15px', maxWidth: '600px', margin: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '26px', fontWeight: 900, margin: 0 }}>Operaciones</h2>
        <Link to="/nuevo" style={{ padding: '12px 20px', backgroundColor: '#1a1d21', color: 'white', textDecoration: 'none', borderRadius: '16px', fontSize: '14px', fontWeight: 800 }}>+ Nueva</Link>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {events.map(event => {
          const soldAssets = event.soldAssets || [];
          const boughtAssets = event.boughtAssetsFromDb || event.boughtAssets || [];
          const currentPrices = event.currentPricesFromDb || {};
          const soldCurrentPrices = event.soldCurrentPricesFromDb || {};
          const initialUsdRate = event.initialUsdRate || 1;
          const currentUsdRate = event.currentUsdRateFromDb || initialUsdRate;

          const totalARS_Init = soldAssets.reduce((sum, a) => sum + (a.quantity * a.priceAtTrade), 0);
          const totalUSD_Init = totalARS_Init / initialUsdRate;
          const totalARS_Now = boughtAssets.reduce((sum, a) => sum + (a.quantity * (currentPrices[a.ticker] || a.priceAtTrade || 0)), 0);
          const totalUSD_Now = totalARS_Now / currentUsdRate;
          const totalARS_Now_Prev = soldAssets.reduce((sum, a) => sum + (a.quantity * (soldCurrentPrices[a.ticker] || a.priceAtTrade || 0)), 0);
          const totalUSD_Now_Prev = totalARS_Now_Prev / currentUsdRate;

          const pUSD = totalUSD_Init > 0 ? ((totalUSD_Now / totalUSD_Init) - 1) * 100 : 0;
          const pARS = totalARS_Init > 0 ? ((totalARS_Now / totalARS_Init) - 1) * 100 : 0;
          const pALFA = totalUSD_Now_Prev > 0 ? ((totalUSD_Now / totalUSD_Now_Prev) - 1) * 100 : 0;
          const profitUSD = totalUSD_Now - totalUSD_Init;
          const profitARS = totalARS_Now - totalARS_Init;

          return (
            <Link key={event.id} to={`/evento/${event.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{ padding: '22px', backgroundColor: 'white', borderRadius: '28px', border: '1px solid #eaecef', position: 'relative', boxShadow: '0 4px 15px rgba(0,0,0,0.03)', opacity: event.isClosed ? 0.7 : 1 }}>
                
                {/* BOTÓN BORRAR - Con espacio reservado */}
                <button onClick={(e) => handleDelete(e, event.id)} style={{ position: 'absolute', top: '20px', right: '20px', border: 'none', background: '#fff0f0', color: '#ff3b30', fontSize: '10px', fontWeight: 800, padding: '6px 12px', borderRadius: '10px', zIndex: 10 }}>BORRAR</button>
                
                <div style={{ marginBottom: '16px' }}>
                  {/* Título con padding-right para no chocar con el botón Borrar */}
                  <h3 style={{ fontSize: '19px', fontWeight: 800, margin: '0 0 8px 0', paddingRight: '80px', lineHeight: '1.2' }}>{event.eventName}</h3>
                  
                  {/* Fila de Meta-info (Fecha y Estado) */}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '15px' }}>
                    <span style={{ fontSize: '11px', color: '#6c757d', fontWeight: 800, backgroundColor: '#f0f2f5', padding: '4px 8px', borderRadius: '6px' }}>
                      {event.tradeDate}
                    </span>
                    {event.isClosed && <span style={{ fontSize: '9px', fontWeight: 900, backgroundColor: '#1a1d21', color: 'white', padding: '4px 8px', borderRadius: '6px' }}>CERRADA</span>}
                  </div>
                  
                  {/* VALORES ACTUALES E INVERTIDOS */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', backgroundColor: '#fcfcfc', padding: '12px', borderRadius: '16px', border: '1px solid #f8f8f8' }}>
                    <div>
                      <div style={{ fontSize: '9px', fontWeight: 900, color: '#198754' }}>VALOR ACTUAL</div>
                      <div style={{ fontSize: '17px', fontWeight: 900 }}>US$ {totalUSD_Now.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                      <div style={{ fontSize: '11px', color: '#198754', fontWeight: 700 }}>$ {totalARS_Now.toLocaleString('es-AR', {maximumFractionDigits: 0})}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '9px', fontWeight: 900, color: '#adb5bd' }}>INVERTIDO</div>
                      <div style={{ fontSize: '17px', fontWeight: 900, color: '#adb5bd' }}>US$ {totalUSD_Init.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                      <div style={{ fontSize: '11px', color: '#adb5bd', fontWeight: 700 }}>$ {totalARS_Init.toLocaleString('es-AR', {maximumFractionDigits: 0})}</div>
                    </div>
                  </div>
                </div>

                {/* PROFITS NOMINALES */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                   <div style={{ fontSize: '11px', fontWeight: 800, color: profitUSD >= 0 ? '#198754' : '#dc3545', backgroundColor: profitUSD >= 0 ? '#eaffeb' : '#fff0f0', padding: '4px 10px', borderRadius: '10px' }}>
                     {profitUSD >= 0 ? '▲' : '▼'} US$ {Math.abs(profitUSD).toLocaleString(undefined, {maximumFractionDigits: 0})}
                   </div>
                   <div style={{ fontSize: '11px', fontWeight: 800, color: profitARS >= 0 ? '#198754' : '#dc3545', backgroundColor: profitARS >= 0 ? '#eaffeb' : '#fff0f0', padding: '4px 10px', borderRadius: '10px' }}>
                     {profitARS >= 0 ? '▲' : '▼'} $ {Math.abs(profitARS).toLocaleString('es-AR', {maximumFractionDigits: 0})}
                   </div>
                </div>

                {/* BADGES RENDIMIENTO */}
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
    </div>
  );
}