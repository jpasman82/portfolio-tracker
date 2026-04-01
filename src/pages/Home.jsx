import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';

export default function Home() {
  const [brokerData, setBrokerData] = useState({
    jpm: { balance: 0, updated: null },
    one: { balance: 0, updated: null },
    latin: { balance: 0, updated: null }
  });
  const [loading, setLoading] = useState(true);
  const [latestGlobalUpdate, setLatestGlobalUpdate] = useState('');

  useEffect(() => {
    const fetchBalances = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "brokerPositions"));
        const newBrokerData = {
          jpm: { balance: 0, updated: null },
          one: { balance: 0, updated: null },
          latin: { balance: 0, updated: null }
        };
        let latestTimestamp = 0;

        querySnapshot.forEach((doc) => {
          const data = doc.data();
          const total = (data.assets || []).reduce((sum, a) => sum + (Number(a.quantity) * Number(a.price)), 0);
          
          newBrokerData[doc.id] = {
            balance: total,
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
          const opcionesFecha = { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' };
          setLatestGlobalUpdate(`Actualizado el ${d.toLocaleDateString('es-AR', opcionesFecha)} hs`);
        } else {
          setLatestGlobalUpdate('Sin registros de actualización');
        }
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    fetchBalances();
  }, []);

  const formatSubDate = (date) => {
    if (!date) return 'Sin datos';
    return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) + ' ' + date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + ' hs';
  };

  const brokers = [
    { id: 'jpm', name: 'J.P. Morgan', ...brokerData.jpm, logo: 'https://logo.clearbit.com/jpmorganchase.com' },
    { id: 'one', name: 'One618', ...brokerData.one, logo: 'https://play-lh.googleusercontent.com/rmyAkju1LNJl3AEF4cN2ef4jGxzmiSfxga17vLkwPDc-nyDkkxP78TEoKj1cxF_xGtLHBs6BWb0ccR5WvhCj' },
    { id: 'latin', name: 'Latin Securities', ...brokerData.latin, logo: 'https://reqlut2.s3.amazonaws.com/uploads/logos/420d0b715847860c019e638a3c54fa61864f5665-5242880.png' }
  ];

  const totalConsolidado = brokers.reduce((sum, b) => sum + b.balance, 0);

  if (loading) return <div style={{ padding: '50px', textAlign: 'center', fontWeight: 800, color: '#adb5bd' }}>Cargando Portfolio...</div>;

  return (
    <div style={{ padding: '30px 20px', maxWidth: '600px', margin: 'auto', backgroundColor: '#fcfcfc', minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', paddingBottom: '100px' }}>
      
      {/* HEADER MARCOS */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 800, color: '#adb5bd', textTransform: 'uppercase', letterSpacing: '1px' }}>Portfolio Manager</div>
          <h2 style={{ fontSize: '28px', fontWeight: 900, margin: '4px 0 0 0', color: '#1a1d21' }}>Marcos</h2>
        </div>
        <div style={{ width: '42px', height: '42px', borderRadius: '50%', backgroundColor: '#1a1d21', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 800, color: 'white', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>
          M
        </div>
      </div>
      
      {/* TARJETA NEGRA CONSOLIDADA */}
      <div style={{ padding: '35px 25px', background: 'linear-gradient(135deg, #111418 0%, #2b3036 100%)', borderRadius: '32px', marginBottom: '35px', color: 'white', boxShadow: '0 15px 30px rgba(0,0,0,0.12)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-20px', right: '-20px', width: '150px', height: '150px', background: 'radial-gradient(circle, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 70%)', borderRadius: '50%' }}></div>
        
        <div style={{ fontSize: '12px', fontWeight: 600, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '10px' }}>Balance Consolidado</div>
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '25px' }}>
          <span style={{ fontSize: '24px', opacity: 0.8, marginRight: '6px' }}>US$</span>
          <span style={{ fontSize: '46px', fontWeight: 900, letterSpacing: '-1px' }}>{totalConsolidado.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
        </div>
        
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '15px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#ced4da' }}>
            {latestGlobalUpdate}
          </div>
        </div>
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '15px', paddingLeft: '5px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#1a1d21', margin: 0 }}>Composición por Broker</h3>
      </div>
      
      {/* LISTA DE BROKERS */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {brokers.map(b => {
          const percentage = totalConsolidado > 0 ? ((b.balance / totalConsolidado) * 100).toFixed(1) : 0;
          
          return (
          <Link key={b.id} to={`/broker/${b.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <div style={{ padding: '22px', backgroundColor: 'white', borderRadius: '24px', border: '1px solid #eaecef', boxShadow: '0 6px 16px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <div style={{ width: '44px', height: '44px', borderRadius: '14px', border: '1px solid #f8f9fa', backgroundColor: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px', boxSizing: 'border-box', boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
                    <img src={b.logo} style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => { e.target.style.display = 'none'; e.target.parentNode.innerHTML = `<span style="font-weight:900;color:#1a1d21;font-size:14px;">${b.name.substring(0,3).toUpperCase()}</span>` }} />
                  </div>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#1a1d21' }}>{b.name}</div>
                    <div style={{ fontSize: '11px', color: '#adb5bd', fontWeight: 600, marginTop: '2px' }}>{formatSubDate(b.updated)}</div>
                  </div>
                </div>
                
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '18px', fontWeight: 900, color: '#1a1d21' }}>US$ {b.balance.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#0d6efd', marginTop: '2px' }}>{percentage}%</div>
                </div>

              </div>
              
              <div style={{ width: '100%', height: '6px', backgroundColor: '#f1f3f5', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${percentage}%`, height: '100%', backgroundColor: '#1a1d21', borderRadius: '3px' }}></div>
              </div>
            </div>
          </Link>
        )})}
      </div>

      {/* BARRA DE NAVEGACIÓN INFERIOR */}
      <div style={{ 
        position: 'fixed', 
        bottom: 0, 
        left: '50%', 
        transform: 'translateX(-50%)', 
        width: '100%', 
        maxWidth: '600px', 
        backgroundColor: 'rgba(255,255,255,0.95)', 
        backdropFilter: 'blur(10px)',
        borderTop: '1px solid #eaecef', 
        display: 'flex', 
        justifyContent: 'space-around', 
        padding: '12px 0', 
        zIndex: 100, 
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' 
      }}>
        {/* Botón Activo: Portfolio */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#1a1d21', textDecoration: 'none', gap: '4px' }}>
          <span style={{ fontSize: '22px' }}>💼</span>
          <span style={{ fontSize: '10px', fontWeight: 900 }}>Portfolio</span>
        </div>
        
        {/* Botón Inactivo: Estrategias */}
        <Link to="/rotaciones" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#adb5bd', textDecoration: 'none', gap: '4px' }}>
          <span style={{ fontSize: '22px', filter: 'grayscale(100%) opacity(0.6)' }}>🔄</span>
          <span style={{ fontSize: '10px', fontWeight: 700 }}>Estrategias</span>
        </Link>
      </div>
      
    </div>
  );
}
