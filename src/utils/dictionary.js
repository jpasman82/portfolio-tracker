import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { assetDictionary } from '../utils/dictionary';

export default function Unified() {
  const [groupedData, setGroupedData] = useState({});
  const [totalUsd, setTotalUsd] = useState(0);
  const [loading, setLoading] = useState(true);

  const parseNum = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    return Number(val.toString().replace(/\./g, '').replace(',', '.')) || 0;
  };

  const fmtUSD = (v) => 'US$ ' + parseNum(v).toLocaleString('en-US', {maximumFractionDigits: 0});
  const fmtQty = (v) => parseNum(v).toLocaleString('es-AR', {maximumFractionDigits: 2});

  useEffect(() => {
    const fetchAndGroup = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "brokerPositions"));
        const unified = {};
        let total = 0;

        querySnapshot.forEach((doc) => {
          const data = doc.data();
          const rate = (doc.id === 'jpm') ? 1 : (parseNum(data.usdRate) || 1);
          
          const debt = parseNum(data.debt);
          if (debt > 0) {
            const tDebt = "DEUDA CAUCIÓN";
            if (!unified[tDebt]) unified[tDebt] = { ticker: tDebt, quantity: 1, valueUsd: 0 };
            unified[tDebt].valueUsd -= debt;
            total -= debt;
          }

          (data.assets || []).forEach(a => {
            if (!a || !a.ticker) return;
            const t = a.ticker.toUpperCase();
            const qty = parseNum(a.quantity);
            const priceUsd = parseNum(a.price) / rate;
            const valueUsd = qty * priceUsd;

            if (valueUsd !== 0) {
              if (!unified[t]) unified[t] = { ticker: t, quantity: 0, valueUsd: 0 };
              unified[t].quantity += qty;
              unified[t].valueUsd += valueUsd;
              total += valueUsd;
            }
          });
        });

        const grouped = {};
        Object.values(unified).forEach(item => {
          const info = assetDictionary[item.ticker] || { cat: 'Otros', sub: 'Sin Clasificar', icon: '❓' };
          
          if (!grouped[info.cat]) grouped[info.cat] = { total: 0, subs: {} };
          if (!grouped[info.cat].subs[info.sub]) grouped[info.cat].subs[info.sub] = { icon: info.icon, total: 0, assets: [] };

          grouped[info.cat].subs[info.sub].assets.push(item);
          grouped[info.cat].subs[info.sub].total += item.valueUsd;
          grouped[info.cat].total += item.valueUsd;
        });

        setGroupedData(grouped);
        setTotalUsd(total);
      } catch (e) {}
      finally { setLoading(false); }
    };
    fetchAndGroup();
  }, []);

  if (loading) return <div style={{ padding: '50px', textAlign: 'center', fontWeight: 800, color: '#adb5bd' }}>Analizando Cartera...</div>;

  return (
    <div style={{ padding: '30px 20px', maxWidth: '600px', margin: 'auto', backgroundColor: '#fcfcfc', minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', paddingBottom: '120px' }}>
      
      <div style={{ marginBottom: '35px' }}>
        <h2 style={{ fontSize: '28px', fontWeight: 900, margin: '0 0 5px 0', color: '#1a1d21' }}>Cartera Unificada</h2>
        <div style={{ fontSize: '14px', fontWeight: 800, color: '#adb5bd' }}>Vista consolidada por sectores</div>
      </div>

      <div style={{ backgroundColor: '#1a1d21', padding: '24px', borderRadius: '24px', color: 'white', marginBottom: '30px', boxShadow: '0 10px 20px rgba(0,0,0,0.1)' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Valor Total Neto</div>
        <div style={{ fontSize: '36px', fontWeight: 900 }}>{fmtUSD(totalUsd)}</div>
      </div>

      {Object.keys(groupedData).sort().map(cat => (
        <div key={cat} style={{ marginBottom: '35px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '16px', borderBottom: '2px solid #eaecef', paddingBottom: '8px' }}>
            <h3 style={{ fontSize: '22px', fontWeight: 900, color: '#1a1d21', margin: 0 }}>{cat}</h3>
            <span style={{ fontSize: '16px', fontWeight: 900, color: '#adb5bd' }}>{fmtUSD(groupedData[cat].total)}</span>
          </div>

          {Object.keys(groupedData[cat].subs).sort().map(sub => (
            <div key={sub} style={{ backgroundColor: 'white', borderRadius: '24px', padding: '20px', marginBottom: '16px', border: '1px solid #eaecef', boxShadow: '0 4px 10px rgba(0,0,0,0.02)' }}>
              
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '24px', backgroundColor: '#f8f9fa', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '12px' }}>
                  {groupedData[cat].subs[sub].icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#1a1d21' }}>{sub}</div>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: '#adb5bd' }}>{fmtUSD(groupedData[cat].subs[sub].total)}</div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {groupedData[cat].subs[sub].assets.map(asset => (
                  <div key={asset.ticker} style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #f8f9fa', paddingTop: '10px' }}>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 900, color: asset.valueUsd < 0 ? '#ff3b30' : '#495057' }}>{asset.ticker}</div>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: '#adb5bd' }}>{asset.ticker === "DEUDA CAUCIÓN" ? "Pasivo financiero" : `${fmtQty(asset.quantity)} nominales`}</div>
                    </div>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: asset.valueUsd < 0 ? '#ff3b30' : '#198754', alignSelf: 'center' }}>
                      {fmtUSD(asset.valueUsd)}
                    </div>
                  </div>
                ))}
              </div>

            </div>
          ))}
        </div>
      ))}

      <div style={{ position: 'fixed', bottom: '30px', left: '50%', transform: 'translateX(-50%)', display: 'flex', backgroundColor: '#1a1d21', padding: '6px', borderRadius: '30px', gap: '4px', zIndex: 1000, boxShadow: '0 10px 25px rgba(0,0,0,0.15)' }}>
        <Link to="/" style={{ padding: '12px 20px', borderRadius: '24px', backgroundColor: 'transparent', color: '#adb5bd', textDecoration: 'none', fontWeight: 700, fontSize: '13px', transition: 'all 0.2s', textAlign: 'center', minWidth: '80px' }}>
          Brokers
        </Link>
        <Link to="/unificada" style={{ padding: '12px 20px', borderRadius: '24px', backgroundColor: 'white', color: '#1a1d21', textDecoration: 'none', fontWeight: 800, fontSize: '13px', transition: 'all 0.2s', textAlign: 'center', minWidth: '80px' }}>
          Cartera
        </Link>
        <Link to="/rotaciones" style={{ padding: '12px 20px', borderRadius: '24px', backgroundColor: 'transparent', color: '#adb5bd', textDecoration: 'none', fontWeight: 700, fontSize: '13px', transition: 'all 0.2s', textAlign: 'center', minWidth: '80px' }}>
          Estrategias
        </Link>
      </div>

    </div>
  );
}
