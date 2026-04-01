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
            const t = a.ticker.toUpperCase().trim();
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

  const pieData = [];
  let totalForPie = 0;
  const colors = ['#0d6efd', '#ffc107', '#198754', '#6f42c1', '#fd7e14', '#20c997', '#e83e8c'];

  Object.keys(groupedData).forEach((cat) => {
    if (groupedData[cat].total > 0) {
      totalForPie += groupedData[cat].total;
    }
  });

  let colorIndex = 0;
  Object.keys(groupedData).forEach((cat) => {
    if (groupedData[cat].total > 0) {
      pieData.push({
        name: cat,
        value: groupedData[cat].total,
        percentage: (groupedData[cat].total / totalForPie) * 100,
        color: colors[colorIndex % colors.length]
      });
      colorIndex++;
    }
  });

  pieData.sort((a, b) => b.value - a.value);

  let cumulative = 0;
  const gradientStops = pieData.map(slice => {
    const start = cumulative;
    const end = cumulative + slice.percentage;
    cumulative = end;
    return `${slice.color} ${start}% ${end}%`;
  });
  const conicGradient = pieData.length > 0 ? `conic-gradient(${gradientStops.join(', ')})` : '';

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

      {pieData.length > 0 && (
        <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '24px', border: '1px solid #eaecef', marginBottom: '35px', boxShadow: '0 4px 10px rgba(0,0,0,0.02)' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 900, color: '#1a1d21', margin: '0 0 24px 0', textAlign: 'center' }}>Composición de Activos</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '30px' }}>
            <div style={{ width: '200px', height: '200px', borderRadius: '50%', background: conicGradient, boxShadow: '0 8px 16px rgba(0,0,0,0.08)' }}></div>
            
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {pieData.map(item => (
                <div key={item.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '14px', height: '14px', borderRadius: '4px', backgroundColor: item.color }}></div>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: '#495057' }}>{item.name}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '15px', fontWeight: 900, color: '#1a1d21', marginRight: '10px' }}>{item.percentage.toFixed(1)}%</span>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#adb5bd' }}>{fmtUSD(item.value)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {Object.keys(groupedData).sort().map(cat => (
        <div key={cat} style={{ marginBottom: '35px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '16px', borderBottom: '2px solid #eaecef', paddingBottom: '8px' }}>
            <h3 style={{ fontSize: '22px', fontWeight: 900, color: '#1a1d21', margin: 0 }}>{cat}</h3>
            <span style={{ fontSize: '16px', fontWeight: 900, color: groupedData[cat].total < 0 ? '#ff3b30' : '#adb5bd' }}>
              {fmtUSD(groupedData[cat].total)}
            </span>
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
