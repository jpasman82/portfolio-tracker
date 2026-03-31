import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';

export default function Home() {
  const [balances, setBalances] = useState({ jpm: 0, one: 0, latin: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBalances = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "brokerPositions"));
        const newBalances = { jpm: 0, one: 0, latin: 0 };
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          const total = (data.assets || []).reduce((sum, a) => sum + (a.quantity * a.price), 0);
          newBalances[doc.id] = total;
        });
        setBalances(newBalances);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    fetchBalances();
  }, []);

  const brokers = [
    { id: 'jpm', name: 'JP Morgan', balance: balances.jpm, logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/af/J_P_Morgan_Chase_Logo_2008-1.svg/512px-J_P_Morgan_Chase_Logo_2008-1.svg.png' },
    { id: 'one', name: 'One618', balance: balances.one, logo: 'https://play-lh.googleusercontent.com/rmyAkju1LNJl3AEF4cN2ef4jGxzmiSfxga17vLkwPDc-nyDkkxP78TEoKj1cxF_xGtLHBs6BWb0ccR5WvhCj' },
    { id: 'latin', name: 'Latin Securities', balance: balances.latin, logo: 'https://reqlut2.s3.amazonaws.com/uploads/logos/420d0b715847860c019e638a3c54fa61864f5665-5242880.png' }
  ];

  const totalConsolidado = brokers.reduce((sum, b) => sum + b.balance, 0);

  return (
    <div style={{ padding: '24px 15px', maxWidth: '600px', margin: 'auto', backgroundColor: '#f8f9fa', minHeight: '100vh' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 900, marginBottom: '20px' }}>Hola, María</h2>

      <div style={{ padding: '30px 20px', backgroundColor: '#1a1d21', borderRadius: '28px', marginBottom: '25px', boxShadow: '0 10px 20px rgba(0,0,0,0.1)', color: 'white' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, opacity: 0.8, textTransform: 'uppercase', marginBottom: '8px' }}>Total Consolidado</div>
        <div style={{ fontSize: '36px', fontWeight: 900 }}>US$ {totalConsolidado.toLocaleString()}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '35px' }}>
        {brokers.map(b => (
          <Link key={b.id} to={`/broker/${b.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{ padding: '18px', backgroundColor: 'white', borderRadius: '20px', border: '1px solid #eaecef', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <div style={{ width: '45px', height: '45px', borderRadius: '12px', border: '1px solid #eee', overflow: 'hidden' }}>
                  <img src={b.logo} alt={b.name} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '4px' }} onError={(e) => { e.target.src='https://via.placeholder.com/45?text='+b.name[0] }}/>
                </div>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 800 }}>{b.name}</div>
                  <div style={{ fontSize: '12px', color: '#adb5bd' }}>Ver detalle</div>
                </div>
              </div>
              <div style={{ fontSize: '18px', fontWeight: 900 }}>US$ {b.balance.toLocaleString()}</div>
            </div>
          </Link>
        ))}
      </div>

      <Link to="/rotaciones" style={{ display: 'block', padding: '20px', backgroundColor: 'white', color: '#1a1d21', textDecoration: 'none', borderRadius: '20px', textAlign: 'center', fontWeight: 800, border: '1px solid #1a1d21' }}>
        🔄 Tracker de Estrategias (María)
      </Link>
    </div>
  );
}
