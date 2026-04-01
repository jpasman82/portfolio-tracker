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
          setLatestGlobalUpdate(`${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}hs`);
        }
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    fetchBalances();
  }, []);

  const formatSubDate = (date) => {
    if (!date) return 'Sin datos';
    return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' hs';
  };

  const brokers = [
    { id: 'jpm', name: 'JP Morgan', ...brokerData.jpm, logo: 'https://logo.clearbit.com/jpmorganchase.com' },
    { id: 'one', name: 'One618', ...brokerData.one, logo: 'https://play-lh.googleusercontent.com/rmyAkju1LNJl3AEF4cN2ef4jGxzmiSfxga17vLkwPDc-nyDkkxP78TEoKj1cxF_xGtLHBs6BWb0ccR5WvhCj' },
    { id: 'latin', name: 'Latin Securities', ...brokerData.latin, logo: 'https://reqlut2.s3.amazonaws.com/uploads/logos/420d0b715847860c019e638a3c54fa61864f5665-5242880.png' }
  ];

  const totalConsolidado = brokers.reduce((sum, b) => sum + b.balance, 0);

  if (loading) return <div style={{ padding: '50px', textAlign: 'center', fontWeight: 800 }}>Cargando Portfolio...</div>;

  return (
    <div style={{ padding: '24px 15px', maxWidth: '600px', margin: 'auto', backgroundColor: '#f8f9fa', minHeight: '100vh' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 900, marginBottom: '20px' }}>Hola, Marcos</h2>
      
      <div style={{ padding: '30px 20px', backgroundColor: '#1a1d21', borderRadius: '28px', marginBottom: '25px', color: 'white' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, opacity: 0.8, textTransform: 'uppercase', marginBottom: '8px' }}>Total Consolidado</div>
        <div style={{ fontSize: '42px', fontWeight: 900, marginBottom: '15px' }}>US$ {totalConsolidado.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#adb5bd', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '15px' }}>
          Última actividad: {latestGlobalUpdate || '---'}
        </div>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '35px' }}>
        {brokers.map(b => (
          <Link key={b.id} to={`/broker/${b.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <div style={{ padding: '24px 20px', backgroundColor: 'white', borderRadius: '20px', border: '1px solid #eaecef', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flex: 1 }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '12px', border: '1px solid #eee', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'white', flexShrink: 0 }}>
                  <img src={b.logo} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '6px' }} onError={(e) => { e.target.style.display = 'none'; e.target.parentNode.innerHTML = `<span style="font-weight:900;color:#1a1d21;font-size:14px;">${b.name.substring(0,3).toUpperCase()}</span>` }} />
                </div>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: 800 }}>{b.name}</div>
                  <div style={{ fontSize: '11px', color: '#adb5bd', fontWeight: 600, marginTop: '2px' }}>
                    Act: {formatSubDate(b.updated)}
                  </div>
                </div>
              </div>
              
              <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '15px' }}>
                <div style={{ fontSize: '26px', fontWeight: 900, color: '#1a1d21' }}>US$ {b.balance.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                <div style={{ fontSize: '24px', color: '#dee2e6', fontWeight: 900, marginTop: '-2px' }}>›</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
      
      <Link to="/rotaciones" style={{ display: 'block', padding: '20px', backgroundColor: 'white', color: '#1a1d21', textDecoration: 'none', borderRadius: '20px', textAlign: 'center', fontWeight: 800, border: '1px solid #1a1d21' }}>
        🔄 Ver Estrategias de De María
      </Link>
    </div>
  );
}
