import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { assetDictionary } from '../utils/dictionary';
import { isBondTicker } from '../utils/priceService';
import './Unified.css';

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

  const fmtUSD = (v) => 'US$ ' + parseNum(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const fmtQty = (v) => parseNum(v).toLocaleString('es-AR', { maximumFractionDigits: 2 });

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

        // Sort assets within each sub by value desc
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

  // Sort categories by total descending (negatives last)
  const sortedCats = Object.keys(groupedData).sort((a, b) => groupedData[b].total - groupedData[a].total);

  // Assign a color to each category
  const catColors = {};
  sortedCats.forEach((cat, i) => { catColors[cat] = baseColors[i % baseColors.length]; });

  // Build pie data
  let pieData = [];
  let totalForPie = 0;

  if (pieMode === 'cat') {
    sortedCats.forEach(cat => { if (groupedData[cat].total > 0) totalForPie += groupedData[cat].total; });
    sortedCats.forEach(cat => {
      if (groupedData[cat].total > 0) {
        pieData.push({ name: cat, value: groupedData[cat].total, percentage: (groupedData[cat].total / totalForPie) * 100, color: catColors[cat] });
      }
    });
  } else {
    let cIdx = 0;
    sortedCats.forEach(cat => {
      Object.keys(groupedData[cat].subs).forEach(sub => {
        if (groupedData[cat].subs[sub].total > 0) totalForPie += groupedData[cat].subs[sub].total;
      });
    });
    sortedCats.forEach(cat => {
      // Sort subs by value desc for pie too
      const sortedSubs = Object.keys(groupedData[cat].subs).sort((a, b) => groupedData[cat].subs[b].total - groupedData[cat].subs[a].total);
      sortedSubs.forEach(sub => {
        if (groupedData[cat].subs[sub].total > 0) {
          pieData.push({ name: sub, value: groupedData[cat].subs[sub].total, percentage: (groupedData[cat].subs[sub].total / totalForPie) * 100, color: baseColors[cIdx % baseColors.length] });
          cIdx++;
        }
      });
    });
  }

  const radius = 70;
  const strokeWidth = 35;
  const circ = 2 * Math.PI * radius;
  let strokeOffset = 0;

  // Gross total (for debt % calculation)
  const grossTotal = totalUsd + Object.values(groupedData)
    .flatMap(cat => Object.values(cat.subs).flatMap(sub => sub.assets))
    .filter(a => a.valueUsd < 0)
    .reduce((sum, a) => sum + Math.abs(a.valueUsd), 0);

  return (
    <div className="u-page">

      {/* Header */}
      <div className="u-header" style={{ marginBottom: '35px' }}>
        <h2 style={{ fontSize: '28px', fontWeight: 900, margin: '0 0 4px 0', color: '#1a1d21' }}>Cartera Unificada</h2>
        <div className="u-subtitle" style={{ fontSize: '14px', fontWeight: 800, color: '#adb5bd' }}>Vista consolidada por sectores</div>
      </div>

      <div className="u-grid">

        {/* ── LEFT: Detail ── */}
        <div className="u-detail">
          {sortedCats.map(cat => {
            const catColor = catColors[cat];
            const catPct = totalUsd > 0 ? ((groupedData[cat].total / totalUsd) * 100) : 0;
            // Sort subs by value desc
            const sortedSubs = Object.keys(groupedData[cat].subs).sort((a, b) => groupedData[cat].subs[b].total - groupedData[cat].subs[a].total);

            return (
              <div key={cat} className="u-cat-section" style={{ borderLeftColor: catColor, marginBottom: '35px' }}>
                {/* Category header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', paddingBottom: '10px', borderBottom: `2px solid ${catColor}22` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '3px', backgroundColor: catColor, flexShrink: 0 }} />
                    <h3 className="u-cat-title" style={{ fontSize: '20px', fontWeight: 900, color: '#1a1d21', margin: 0 }}>{cat}</h3>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '16px', fontWeight: 900, color: groupedData[cat].total < 0 ? '#ff3b30' : '#1a1d21' }}>
                      {fmtUSD(groupedData[cat].total)}
                    </span>
                    {totalUsd > 0 && (
                      <span className="u-cat-pct" style={{ fontSize: '12px', fontWeight: 800, color: catColor, marginLeft: '8px' }}>
                        {catPct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>

                {/* Category progress bar */}
                <div style={{ height: '3px', backgroundColor: '#f0f1f3', borderRadius: '2px', marginBottom: '16px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max(0, catPct)}%`, backgroundColor: catColor, borderRadius: '2px' }} />
                </div>

                {/* Sub-categories */}
                {sortedSubs.map(sub => {
                  const subData = groupedData[cat].subs[sub];
                  const subPct = totalUsd > 0 ? ((subData.total / totalUsd) * 100) : 0;

                  return (
                    <div key={sub} className="u-sub-card" style={{ backgroundColor: 'white', borderRadius: '20px', padding: '20px', marginBottom: '12px', border: '1px solid #eaecef', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>

                      {/* Sub header */}
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '14px' }}>
                        <div style={{ fontSize: '20px', backgroundColor: `${catColor}15`, width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', flexShrink: 0 }}>
                          {subData.icon}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="u-sub-title" style={{ fontSize: '15px', fontWeight: 800, color: '#1a1d21' }}>{sub}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                            <span className="u-sub-amount" style={{ fontSize: '12px', fontWeight: 700, color: '#adb5bd' }}>{fmtUSD(subData.total)}</span>
                            {totalUsd > 0 && (
                              <span style={{ fontSize: '10px', fontWeight: 900, color: 'white', backgroundColor: catColor, padding: '1px 6px', borderRadius: '5px' }}>
                                {subPct.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Asset rows */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {/* Desktop table header */}
                        <div className="u-asset-row u-table-header" style={{ paddingTop: 0, borderTop: 'none', opacity: 0.45, fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#6c757d' }}>
                          <span>Ticker</span>
                          <span>Nominales</span>
                          <span style={{ textAlign: 'right' }}>Valor USD</span>
                          <span className="u-asset-pct-bar">% Cartera</span>
                        </div>

                        {subData.assets.map(asset => {
                          const denominator = asset.valueUsd < 0 ? grossTotal : totalUsd;
                          const pct = denominator > 0 ? (Math.abs(asset.valueUsd) / denominator) * 100 : 0;
                          const isDebt = asset.valueUsd < 0;

                          return (
                            <div key={asset.ticker} className="u-asset-row">
                              {/* Ticker */}
                              <div>
                                <div className="u-asset-ticker-text" style={{ fontSize: '14px', fontWeight: 900, color: isDebt ? '#ff3b30' : '#1a1d21' }}>{asset.ticker}</div>
                              </div>

                              {/* Quantity */}
                              <div style={{ fontSize: '11px', fontWeight: 700, color: '#adb5bd' }}>
                                {asset.ticker === 'DEUDA CAUCIÓN' ? 'Pasivo financiero' : `${fmtQty(asset.quantity)} nom.`}
                              </div>

                              {/* Value */}
                              <div style={{ textAlign: 'right' }}>
                                <div className="u-asset-val" style={{ fontSize: '14px', fontWeight: 800, color: isDebt ? '#ff3b30' : '#198754' }}>
                                  {fmtUSD(asset.valueUsd)}
                                </div>
                                {/* % shown only on mobile (desktop uses the bar column) */}
                                <div className="u-mobile-pct" style={{ fontSize: '10px', fontWeight: 800, color: '#adb5bd' }}>
                                  {pct.toFixed(1)}% cartera
                                </div>
                              </div>

                              {/* % bar (desktop only) */}
                              <div className="u-asset-pct-bar">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                  <span style={{ fontSize: '11px', fontWeight: 900, color: catColor }}>{pct.toFixed(1)}%</span>
                                </div>
                                <div className="u-asset-pct-bar-track">
                                  <div className="u-asset-pct-bar-fill" style={{ width: `${Math.min(100, pct * 4)}%`, backgroundColor: catColor }} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* ── RIGHT: Sidebar ── */}
        <div className="u-sidebar">

          {/* Total value card */}
          <div style={{ backgroundColor: '#1a1d21', padding: '24px', borderRadius: '24px', color: 'white', marginBottom: '20px', boxShadow: '0 10px 20px rgba(0,0,0,0.1)' }}>
            <div className="u-total-label" style={{ fontSize: '11px', fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Valor Total Neto</div>
            <div className="u-total-amount" style={{ fontSize: '34px', fontWeight: 900, letterSpacing: '-1px' }}>{fmtUSD(totalUsd)}</div>
            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {sortedCats.filter(c => groupedData[c].total > 0).slice(0, 4).map(cat => (
                <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '2px', backgroundColor: catColors[cat] }} />
                    <span style={{ fontSize: '11px', fontWeight: 700, opacity: 0.8 }}>{cat}</span>
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: 900, color: catColors[cat] }}>
                    {((groupedData[cat].total / totalUsd) * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Pie chart */}
          {pieData.length > 0 && (
            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '24px', border: '1px solid #eaecef', boxShadow: '0 4px 10px rgba(0,0,0,0.02)' }}>

              <div style={{ display: 'flex', backgroundColor: '#f8f9fa', borderRadius: '12px', padding: '4px', marginBottom: '20px', width: 'fit-content', margin: '0 auto 20px auto' }}>
                <button onClick={() => setPieMode('cat')} style={{ border: 'none', background: pieMode === 'cat' ? 'white' : 'transparent', color: pieMode === 'cat' ? '#1a1d21' : '#adb5bd', padding: '8px 16px', borderRadius: '10px', fontSize: '12px', fontWeight: 800, boxShadow: pieMode === 'cat' ? '0 2px 6px rgba(0,0,0,0.05)' : 'none', cursor: 'pointer' }}>Categorías</button>
                <button onClick={() => setPieMode('sub')} style={{ border: 'none', background: pieMode === 'sub' ? 'white' : 'transparent', color: pieMode === 'sub' ? '#1a1d21' : '#adb5bd', padding: '8px 16px', borderRadius: '10px', fontSize: '12px', fontWeight: 800, boxShadow: pieMode === 'sub' ? '0 2px 6px rgba(0,0,0,0.05)' : 'none', cursor: 'pointer' }}>Rubros</button>
              </div>

              <div className="pie-wrap">
                <svg width="100%" height="100%" viewBox="0 0 200 200" style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}>
                  {pieData.map((slice) => {
                    const strokeLength = (slice.percentage / 100) * circ;
                    const sDasharray = `${strokeLength} ${circ - strokeLength}`;
                    const sDashoffset = -strokeOffset;
                    strokeOffset += strokeLength;
                    return (
                      <circle key={slice.name} cx="100" cy="100" r={radius} fill="transparent"
                        stroke={slice.color}
                        strokeWidth={hoverData && hoverData.name === slice.name ? strokeWidth + 6 : strokeWidth}
                        strokeDasharray={sDasharray}
                        strokeDashoffset={sDashoffset}
                        style={{ transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)', cursor: 'pointer', opacity: hoverData && hoverData.name !== slice.name ? 0.25 : 1 }}
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
                      <div style={{ fontSize: '10px', fontWeight: 900, color: '#adb5bd', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px', maxWidth: '90px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hoverData.name}</div>
                      <div style={{ fontSize: '24px', fontWeight: 900, color: hoverData.color, lineHeight: '1' }}>{hoverData.percentage.toFixed(1)}%</div>
                      <div style={{ fontSize: '10px', fontWeight: 800, color: '#1a1d21', marginTop: '4px' }}>{fmtUSD(hoverData.value)}</div>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', fontWeight: 800, color: '#adb5bd' }}>Composición</div>
                      <div style={{ fontSize: '9px', fontWeight: 700, color: '#dee2e6' }}>(Tocar)</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Legend */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid #f8f9fa', paddingTop: '16px' }}>
                {pieData.map(item => (
                  <div key={item.name}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px', borderRadius: '8px', backgroundColor: hoverData && hoverData.name === item.name ? '#f8f9fa' : 'transparent', transition: 'background 0.2s', cursor: 'pointer' }}
                    onMouseEnter={() => setHoverData(item)} onMouseLeave={() => setHoverData(null)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '3px', backgroundColor: item.color, flexShrink: 0 }} />
                      <span className="u-legend-name" style={{ fontSize: '12px', fontWeight: 800, color: '#495057' }}>{item.name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span className="u-legend-val" style={{ fontSize: '11px', fontWeight: 700, color: '#adb5bd' }}>{fmtUSD(item.value)}</span>
                      <span className="u-legend-pct" style={{ fontSize: '12px', fontWeight: 900, color: '#1a1d21', minWidth: '40px', textAlign: 'right' }}>{item.percentage.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>

            </div>
          )}

        </div>
      </div>

      {/* Bottom nav */}
      <div className="u-bottomnav">
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#adb5bd', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span style={{ fontSize: '11px', fontWeight: 800 }}>Brokers</span>
        </Link>
        <Link to="/unificada" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#1a1d21', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
          <span style={{ fontSize: '11px', fontWeight: 800 }}>Cartera</span>
        </Link>
        <Link to="/rotaciones" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#adb5bd', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="18" y="3" width="4" height="18"/><rect x="10" y="8" width="4" height="13"/><rect x="2" y="13" width="4" height="8"/></svg>
          <span style={{ fontSize: '11px', fontWeight: 800 }}>Estrategias</span>
        </Link>
      </div>

    </div>
  );
}
