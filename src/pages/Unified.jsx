import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { assetDictionary } from '../utils/dictionary';
import { isBondTicker } from '../utils/priceService';

export default function Unified() {
  const [groupedData, setGroupedData] = useState({});
  const [totalUsd, setTotalUsd] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pieMode, setPieMode] = useState('cat'); 
  const [hoverData, setHoverData] = useState(null);

  const baseColors = ['#0d6efd', '#20c997', '#ffc107', '#6f42c1', '#fd7e14', '#e83e8c', '#198754', '#0dcaf0', '#d63384', '#6610f2', '#ff5733', '#00b4d8', '#343a40'];

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
            const isBond = a.isBond || isBondTicker(t);
            const bondDivisor = isBond ? 100 : 1;
            const priceUsd = parseNum(a.price) / rate / bondDivisor;
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

        Object.keys(grouped).forEach(cat => {
          Object.keys(grouped[cat].subs).forEach(sub => {
            grouped[cat].subs[sub].assets.sort((a, b) => b.valueUsd - a.valueUsd);
          });
        });

        setGroupedData(grouped);
        setTotalUsd(total);
      } catch (e) {}
      finally { setLoading(false); }
    };
    fetchAndGroup();
  }, []);

  if (loading) return <div style={{ padding: '50px', textAlign: 'center', fontWeight: 800, color: '#adb5bd' }}>Analizando Cartera...</div>;

  let pieData = [];
  let totalForPie = 0;

  if (pieMode === 'cat') {
    Object.keys(groupedData).forEach(cat => {
      if (groupedData[cat].total > 0) totalForPie += groupedData[cat].total;
    });
    let cIdx = 0;
    Object.keys(groupedData).forEach(cat => {
      if (groupedData[cat].total > 0) {
        pieData.push({ name: cat, value: groupedData[cat].total, percentage: (groupedData[cat].total / totalForPie) * 100, color: baseColors[cIdx % baseColors.length] });
        cIdx++;
      }
    });
  } else {
    Object.keys(groupedData).forEach(cat => {
      Object.keys(groupedData[cat].subs).forEach(sub => {
        if (groupedData[cat].subs[sub].total > 0) totalForPie += groupedData[cat].subs[sub].total;
      });
    });
    let cIdx = 0;
    Object.keys(groupedData).forEach(cat => {
      Object.keys(groupedData[cat].subs).forEach(sub => {
        if (groupedData[cat].subs[sub].total > 0) {
          pieData.push({ name: sub, value: groupedData[cat].subs[sub].total, percentage: (groupedData[cat].subs[sub].total / totalForPie) * 100, color: baseColors[cIdx % baseColors.length] });
          cIdx++;
        }
      });
    });
  }

  pieData.sort((a, b) => b.value - a.value);

  const radius = 70;
  const strokeWidth = 35;
  const circ = 2 * Math.PI * radius;
  let strokeOffset = 0;

  return (
    <div style={{ padding: '30px 20px', maxWidth: '600px', margin: 'auto', backgroundColor: '#fcfcfc', minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', paddingBottom: '100px' }}>
      
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
          
          <div style={{ display: 'flex', backgroundColor: '#f8f9fa', borderRadius: '12px', padding: '4px', marginBottom: '30px', margin: '0 auto 30px auto', width: 'fit-content' }}>
            <button onClick={() => setPieMode('cat')} style={{ border: 'none', background: pieMode === 'cat' ? 'white' : 'transparent', color: pieMode === 'cat' ? '#1a1d21' : '#adb5bd', padding: '10px 20px', borderRadius: '10px', fontSize: '13px', fontWeight: 800, boxShadow: pieMode === 'cat' ? '0 2px 6px rgba(0,0,0,0.05)' : 'none', cursor: 'pointer' }}>Categorías</button>
            <button onClick={() => setPieMode('sub')} style={{ border: 'none', background: pieMode === 'sub' ? 'white' : 'transparent', color: pieMode === 'sub' ? '#1a1d21' : '#adb5bd', padding: '10px 20px', borderRadius: '10px', fontSize: '13px', fontWeight: 800, boxShadow: pieMode === 'sub' ? '0 2px 6px rgba(0,0,0,0.05)' : 'none', cursor: 'pointer' }}>Subcategorías</button>
          </div>

          <div style={{ position: 'relative', width: '220px', height: '220px', margin: '0 auto 24px auto' }}>
            <svg width="220" height="220" viewBox="0 0 200 200" style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}>
              {pieData.map((slice) => {
                const strokeLength = (slice.percentage / 100) * circ;
                const sDasharray = `${strokeLength} ${circ - strokeLength}`;
                const sDashoffset = -strokeOffset;
                strokeOffset += strokeLength;

                return (
                  <circle
                    key={slice.name}
                    cx="100"
                    cy="100"
                    r={radius}
                    fill="transparent"
                    stroke={slice.color}
                    strokeWidth={hoverData && hoverData.name === slice.name ? strokeWidth + 6 : strokeWidth}
                    strokeDasharray={sDasharray}
                    strokeDashoffset={sDashoffset}
                    style={{
                      transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                      cursor: 'pointer',
                      opacity: hoverData && hoverData.name !== slice.name ? 0.25 : 1
                    }}
                    onMouseEnter={() => setHoverData(slice)}
                    onMouseLeave={() => setHoverData(null)}
                    onTouchStart={() => setHoverData(slice)}
                  />
                );
              })}
            </svg>

            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', pointerEvents: 'none' }}>
              {hoverData ? (
                <div style={{ textAlign: 'center', padding: '10px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 900, color: '#adb5bd', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px', maxWidth: '100px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hoverData.name}</div>
                  <div style={{ fontSize: '26px', fontWeight: 900, color: hoverData.color, lineHeight: '1' }}>{hoverData.percentage.toFixed(1)}%</div>
                  <div style={{ fontSize: '11px', fontWeight: 800, color: '#1a1d21', marginTop: '4px' }}>{fmtUSD(hoverData.value)}</div>
                </div>
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#adb5bd' }}>Composición</div>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#dee2e6' }}>(Tocar porción)</div>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #f8f9fa', paddingTop: '20px' }}>
            {pieData.map(item => (
              <div 
                key={item.name} 
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderRadius: '10px', backgroundColor: hoverData && hoverData.name === item.name ? '#f8f9fa' : 'transparent', transition: 'background 0.2s', cursor: 'pointer' }}
                onMouseEnter={() => setHoverData(item)}
                onMouseLeave={() => setHoverData(null)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: item.color }}></div>
                  <span style={{ fontSize: '13px', fontWeight: 800, color: '#495057' }}>{item.name}</span>
                </div>
                <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#adb5bd' }}>{fmtUSD(item.value)}</span>
                  <span style={{ fontSize: '13px', fontWeight: 900, color: '#1a1d21', minWidth: '45px' }}>{item.percentage.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>

        </div>
      )}

      {Object.keys(groupedData).sort().map(cat => (
        <div key={cat} style={{ marginBottom: '35px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '16px', borderBottom: '2px solid #eaecef', paddingBottom: '8px' }}>
            <h3 style={{ fontSize: '22px', fontWeight: 900, color: '#1a1d21', margin: 0 }}>{cat}</h3>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '16px', fontWeight: 900, color: groupedData[cat].total < 0 ? '#ff3b30' : '#adb5bd' }}>
                {fmtUSD(groupedData[cat].total)}
              </span>
              {totalUsd > 0 && (
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#adb5bd', marginLeft: '8px' }}>
                  {((groupedData[cat].total / totalUsd) * 100).toFixed(1)}%
                </span>
              )}
            </div>
          </div>

          {Object.keys(groupedData[cat].subs).sort().map(sub => (
            <div key={sub} style={{ backgroundColor: 'white', borderRadius: '24px', padding: '20px', marginBottom: '16px', border: '1px solid #eaecef', boxShadow: '0 4px 10px rgba(0,0,0,0.02)' }}>
              
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '24px', backgroundColor: '#f8f9fa', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '12px' }}>
                  {groupedData[cat].subs[sub].icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#1a1d21' }}>{sub}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#adb5bd' }}>{fmtUSD(groupedData[cat].subs[sub].total)}</div>
                    {totalUsd > 0 && (
                      <div style={{ fontSize: '11px', fontWeight: 900, color: 'white', backgroundColor: '#6c757d', padding: '2px 7px', borderRadius: '6px' }}>
                        {((groupedData[cat].subs[sub].total / totalUsd) * 100).toFixed(1)}%
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {groupedData[cat].subs[sub].assets.map(asset => (
                  <div key={asset.ticker} style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #f8f9fa', paddingTop: '10px' }}>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 900, color: asset.valueUsd < 0 ? '#ff3b30' : '#495057' }}>{asset.ticker}</div>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: '#adb5bd' }}>{asset.ticker === "DEUDA CAUCIÓN" ? "Pasivo financiero" : `${fmtQty(asset.quantity)} nominales`}</div>
                    </div>
                    <div style={{ textAlign: 'right', alignSelf: 'center' }}>
                      <div style={{ fontSize: '15px', fontWeight: 800, color: asset.valueUsd < 0 ? '#ff3b30' : '#198754' }}>
                        {fmtUSD(asset.valueUsd)}
                      </div>
                      {totalUsd > 0 && (() => {
                        const denominator = asset.valueUsd < 0 ? (totalUsd - asset.valueUsd) : totalUsd;
                        const pct = (Math.abs(asset.valueUsd) / denominator) * 100;
                        return (
                          <div style={{ fontSize: '10px', fontWeight: 800, color: '#adb5bd' }}>
                            {pct.toFixed(1)}% cartera
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                ))}
              </div>

            </div>
          ))}
        </div>
      ))}

      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '600px', backgroundColor: 'white', display: 'flex', justifyContent: 'space-around', padding: '12px 10px 24px 10px', boxShadow: '0 -4px 20px rgba(0,0,0,0.06)', borderRadius: '24px 24px 0 0', zIndex: 1000, boxSizing: 'border-box' }}>
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#adb5bd', flex: 1 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          <span style={{ fontSize: '11px', fontWeight: 800 }}>Brokers</span>
        </Link>
        <Link to="/unificada" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#1a1d21', flex: 1 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>
          <span style={{ fontSize: '11px', fontWeight: 800 }}>Cartera</span>
        </Link>
        <Link to="/rotaciones" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#adb5bd', flex: 1 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="18" y="3" width="4" height="18"></rect><rect x="10" y="8" width="4" height="13"></rect><rect x="2" y="13" width="4" height="8"></rect></svg>
          <span style={{ fontSize: '11px', fontWeight: 800 }}>Estrategias</span>
        </Link>
      </div>

    </div>
  );
}
