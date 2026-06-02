import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { db, auth } from '../firebase/config';
import { assetDictionary } from '../utils/dictionary';
import { fetchAllPrices, getMepRate, getPriceMeta, isBondTicker } from '../utils/priceService';
import './Unified.css';

const handleLogout = async () => {
  sessionStorage.removeItem('bioUnlocked');
  await signOut(auth);
};

const KICKER = "font-mono text-[12px] tracking-[0.22em] uppercase text-teal-400 flex items-center gap-1.5";
const REFRESH_MS = 60 * 1000;
const APERTURA_MINUTOS = 10 * 60 + 30;
const CIERRE_MINUTOS = 17 * 60;
const BRAZIL_CEDEAR_WATCHLIST = ['XP', 'NU', 'PAX', 'VALE', 'ITUB', 'EWZ'];

function esMercadoAbierto() {
  const ahora = new Date();
  const dia = ahora.getDay();
  const minutos = ahora.getHours() * 60 + ahora.getMinutes();
  return dia >= 1 && dia <= 5 && minutos >= APERTURA_MINUTOS && minutos < CIERRE_MINUTOS;
}

export default function Unified() {
  const [groupedData, setGroupedData] = useState({});
  const [totalUsd, setTotalUsd] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mercadoAbierto, setMercadoAbierto] = useState(() => esMercadoAbierto());
  const [pieMode, setPieMode] = useState('cat');
  const [hoverData, setHoverData] = useState(null);
  const animatedRef = useRef(false);

  const baseColors = ['#2DD4BF', '#34D399', '#FBBF24', '#A78BFA', '#FB923C', '#F472B6', '#4ADE80', '#38BDF8', '#E879F9', '#818CF8', '#FF6B6B', '#22D3EE', '#94A3B8'];

  const parseNum = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    return Number(val.toString().replace(/\./g, '').replace(',', '.')) || 0;
  };

  const fmtUSD = (v) => 'US$ ' + parseNum(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const fmtARS = (v) => '$ ' + parseNum(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtQty = (v) => parseNum(v).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const fmtChangePct = (v) => {
    const n = parseNum(v);
    return `${n > 0 ? '+' : ''}${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  };
  const fetchAndGroup = async ({ showLoading = false } = {}) => {
    if (showLoading) setLoading(true);
    setRefreshing(true);
      try {
        const priceMap = await fetchAllPrices();
        const mepRate = getMepRate();
        const priceMeta = getPriceMeta();
        const querySnapshot = await getDocs(collection(db, "brokerPositions"));
        const unified = {};
        let total = 0;

        querySnapshot.forEach((doc) => {
          const data = doc.data();
          const isJPM = doc.id === 'jpm';
          const rate = isJPM ? 1 : (mepRate || parseNum(data.usdRate) || 1);

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
            let assetPrice = priceMap[t] ?? parseNum(a.price);
            if (isJPM && priceMap[t] !== undefined && mepRate > 0) assetPrice = assetPrice / mepRate;
            const priceUsd = assetPrice / rate / bondDivisor;
            const valueUsd = qty * priceUsd;
            const changePercent = priceMeta[t]?.changePercent ?? null;

            if (valueUsd !== 0) {
              if (!unified[t]) unified[t] = { ticker: t, quantity: 0, valueUsd: 0, changePercent };
              unified[t].quantity += qty;
              unified[t].valueUsd += valueUsd;
              if (changePercent !== null) unified[t].changePercent = changePercent;
              total += valueUsd;
            }
          });
        });

        BRAZIL_CEDEAR_WATCHLIST.forEach((ticker) => {
          if (unified[ticker]) return;
          const unitPriceArs = priceMap[ticker] ?? null;
          const changePercent = priceMeta[ticker]?.changePercent ?? null;

          unified[ticker] = {
            ticker,
            quantity: 0,
            valueUsd: 0,
            changePercent,
            unitPriceArs,
            isWatchlist: true,
          };
        });

        const grouped = {};
        Object.values(unified).forEach(item => {
          const info = assetDictionary[item.ticker] || { cat: 'Otros', sub: 'Sin Clasificar', icon: '?' };
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
      } catch (e) {
        console.error('[Unified] BYMA refresh:', e.message);
      }
      finally {
        if (showLoading) setLoading(false);
        setRefreshing(false);
      }
  };

  useEffect(() => {
    fetchAndGroup({ showLoading: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const updateMarketState = () => {
      setMercadoAbierto(esMercadoAbierto());
    };
    const refreshId = window.setInterval(() => {
      const abierto = esMercadoAbierto();
      setMercadoAbierto(abierto);
      if (abierto) fetchAndGroup();
    }, REFRESH_MS);
    const statusId = window.setInterval(updateMarketState, 30 * 1000);

    return () => {
      window.clearInterval(refreshId);
      window.clearInterval(statusId);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (loading || animatedRef.current) return;
    animatedRef.current = true;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -20px 0px' }
    );
    document.querySelectorAll('.u-sub-card').forEach((el, i) => {
      el.style.transitionDelay = `${(i % 4) * 70}ms`;
      observer.observe(el);
    });
    return () => observer.disconnect();
  }, [loading, groupedData]);

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen bg-[#080F12]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-[#1e3040] border-t-teal-400 rounded-full animate-spin" />
        <p className="font-mono text-[13px] tracking-[0.22em] uppercase text-[#5B8A8A] animate-pulse">Analizando Cartera...</p>
      </div>
    </div>
  );

  const sortedCats = Object.keys(groupedData).sort((a, b) => groupedData[b].total - groupedData[a].total);
  const catColors = {};
  sortedCats.forEach((cat, i) => { catColors[cat] = baseColors[i % baseColors.length]; });

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

  const grossTotal = totalUsd + Object.values(groupedData)
    .flatMap(cat => Object.values(cat.subs).flatMap(sub => sub.assets))
    .filter(a => a.valueUsd < 0)
    .reduce((sum, a) => sum + Math.abs(a.valueUsd), 0);

  return (
    <div className="u-page relative">
      <div className="pointer-events-none absolute top-[-150px] right-[-200px] w-[600px] h-[500px] rounded-full bg-teal-400/[0.04] blur-[100px]" />

      {/* Header */}
      <div className="u-header bg-[#122329] border border-teal-400/15 p-5 rounded-2xl mb-6 shadow-[0_20px_40px_rgba(0,0,0,0.3)] relative z-10">
        <p className={KICKER}>
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2DD4BF]" />
          Vista Consolidada
        </p>
        <div className="u-header-main">
          <h2 className="u-title text-2xl font-bold tracking-tight text-[#F0FAFA] mt-1">Cartera Unificada</h2>
          <div className={`u-market-status ${mercadoAbierto ? 'is-live' : 'is-closed'}`}>
            <span className="u-market-dot" />
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={refreshing ? 'animate-spin' : ''} aria-hidden="true">
              <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
            </svg>
            <span>{mercadoAbierto ? 'En vivo' : 'Mercado cerrado'}</span>
          </div>
        </div>
        <p className="font-mono text-[13px] tracking-[0.15em] uppercase text-[#5B8A8A] mt-1.5">Posición consolidada por sectores</p>
      </div>

      <div className="u-grid relative z-10">

        {/* LEFT: Detail */}
        <div className="u-detail">
          {sortedCats.map(cat => {
            const catColor = catColors[cat];
            const catPct = totalUsd > 0 ? ((groupedData[cat].total / totalUsd) * 100) : 0;
            const sortedSubs = Object.keys(groupedData[cat].subs).sort((a, b) => groupedData[cat].subs[b].total - groupedData[cat].subs[a].total);

            return (
              <div key={cat} className="u-cat-section mb-8">
                {/* Category header */}
                <div className="flex justify-between items-center mb-3 pb-2 border-b" style={{ borderColor: catColor + '22' }}>
                  <div className="flex items-center gap-2">
                    <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: catColor, flexShrink: 0 }} />
                    <h3 className="u-cat-title font-bold text-[#F0FAFA] text-lg">{cat}</h3>
                  </div>
                  <div className="text-right">
                    <span className="font-bold" style={{ color: groupedData[cat].total < 0 ? '#F87171' : '#F0FAFA' }}>
                      {fmtUSD(groupedData[cat].total)}
                    </span>
                    {totalUsd > 0 && (
                      <span className="u-cat-pct font-mono text-sm font-bold ml-2" style={{ color: catColor }}>
                        {catPct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>

                {/* Category progress bar */}
                <div className="h-[3px] bg-[#1e3040] rounded-full mb-4 overflow-hidden">
                  <div style={{ height: '100%', width: `${Math.max(0, catPct)}%`, backgroundColor: catColor, borderRadius: '2px' }} />
                </div>

                {/* Sub-categories */}
                {sortedSubs.map(sub => {
                  const subData = groupedData[cat].subs[sub];
                  const subPct = totalUsd > 0 ? ((subData.total / totalUsd) * 100) : 0;

                  return (
                    <div key={sub} className="u-sub-card bg-[#122329] border border-teal-400/10 hover:border-teal-400/20 rounded-xl p-4 mb-3 transition-colors">
                      {/* Sub header */}
                      <div className="flex gap-3 items-center mb-4">
                        <div style={{ backgroundColor: catColor + '15', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', flexShrink: 0, border: `1px solid ${catColor}25` }}>
                          <span style={{ fontSize: '16px' }}>{subData.icon}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="u-sub-title font-bold text-[#F0FAFA]">{sub}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="u-sub-amount font-mono text-[12px] text-[#5B8A8A]">{fmtUSD(subData.total)}</span>
                            {totalUsd > 0 && (
                              <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ color: catColor, backgroundColor: catColor + '20' }}>
                                {subPct.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Asset rows */}
                      <div className="flex flex-col gap-0">
                        {/* Table header (desktop) */}
                        <div className="u-asset-row u-table-header font-mono text-[11px] tracking-[0.18em] uppercase text-[#5B8A8A] opacity-70 pb-2">
                          <span>Ticker</span>
                          <span>Nominales</span>
                          <span style={{ textAlign: 'right' }}>Valor / Precio</span>
                          <span style={{ textAlign: 'right' }}>Var.</span>
                          <span className="u-asset-pct-bar">% Cartera</span>
                        </div>

                        {subData.assets.map(asset => {
                          const denominator = asset.valueUsd < 0 ? grossTotal : totalUsd;
                          const pct = denominator > 0 ? (Math.abs(asset.valueUsd) / denominator) * 100 : 0;
                          const isDebt = asset.valueUsd < 0;

                          return (
                            <div key={asset.ticker} className="u-asset-row border-t border-teal-400/5 pt-2.5 mt-0">
                              <div>
                                <div className="u-asset-ticker-text font-black font-mono" style={{ color: isDebt ? '#F87171' : '#F0FAFA' }}>
                                  {asset.ticker}
                                </div>
                              </div>
                              <div className="font-mono text-[12px] text-[#5B8A8A]">
                                {asset.ticker === 'DEUDA CAUCIÓN'
                                  ? 'Pasivo'
                                  : asset.isWatchlist
                                    ? 'Seguimiento'
                                    : `${fmtQty(asset.quantity)} nom.`}
                              </div>
                              <div className="u-asset-value-cell">
                                <div className="u-asset-val font-bold" style={{ color: isDebt ? '#F87171' : asset.isWatchlist ? '#A8C8C8' : '#2DD4BF' }}>
                                  {asset.isWatchlist
                                    ? asset.unitPriceArs > 0 ? fmtARS(asset.unitPriceArs) : 'Sin precio'
                                    : fmtUSD(asset.valueUsd)}
                                </div>
                                <div className="u-mobile-pct font-mono text-[12px] text-[#5B8A8A]">
                                  {asset.isWatchlist ? 'Sin posicion' : `${pct.toFixed(1)}% cartera`}
                                </div>
                              </div>
                              <div className="u-asset-change-cell">
                                {!isDebt && asset.changePercent !== null && asset.changePercent !== undefined && (
                                  <span
                                    className="u-asset-change font-mono font-bold"
                                    style={{ color: asset.changePercent > 0 ? '#34D399' : asset.changePercent < 0 ? '#F87171' : '#5B8A8A' }}
                                  >
                                    {fmtChangePct(asset.changePercent)}
                                  </span>
                                )}
                              </div>
                              <div className="u-asset-pct-bar">
                                <div className="flex justify-between items-baseline">
                                  <span className="font-mono text-[12px] font-bold" style={{ color: asset.isWatchlist ? '#5B8A8A' : catColor }}>
                                    {asset.isWatchlist ? 'Watch' : `${pct.toFixed(1)}%`}
                                  </span>
                                </div>
                                <div className="u-asset-pct-bar-track">
                                  <div className="u-asset-pct-bar-fill" style={{ width: asset.isWatchlist ? '0%' : `${Math.min(100, pct * 4)}%`, backgroundColor: catColor }} />
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

        {/* RIGHT: Sidebar */}
        <div className="u-sidebar">

          {/* Total value card */}
          <div className="bg-[#122329] border border-teal-400/20 p-5 rounded-2xl mb-4 shadow-[0_20px_40px_rgba(0,0,0,0.3)]">
            <div className="u-total-label font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A] mb-2">Valor Total Neto</div>
            <div className="u-total-amount font-black tracking-tight text-teal-400">{fmtUSD(totalUsd)}</div>
            <div className="mt-4 flex flex-col gap-2">
              {sortedCats.filter(c => groupedData[c].total > 0).slice(0, 4).map(cat => (
                <div key={cat} className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div style={{ width: '6px', height: '6px', borderRadius: '2px', backgroundColor: catColors[cat] }} />
                    <span className="font-mono text-[12px] text-[#A8C8C8]">{cat}</span>
                  </div>
                  <span className="font-mono text-[12px] font-bold" style={{ color: catColors[cat] }}>
                    {((groupedData[cat].total / totalUsd) * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Pie chart */}
          {pieData.length > 0 && (
            <div className="bg-[#122329] border border-teal-400/15 p-5 rounded-2xl">
              {/* Mode toggle */}
              <div className="flex bg-[#0C1518] border border-teal-400/10 p-1 rounded-xl mb-5 w-fit mx-auto">
                <button
                  onClick={() => setPieMode('cat')}
                  className={`px-4 py-1.5 rounded-lg font-mono text-[12px] font-bold uppercase tracking-[0.15em] transition-colors ${
                    pieMode === 'cat'
                      ? 'bg-teal-400/10 text-teal-300 border border-teal-400/30'
                      : 'text-[#5B8A8A] hover:text-[#A8C8C8]'
                  }`}
                >
                  Categorías
                </button>
                <button
                  onClick={() => setPieMode('sub')}
                  className={`px-4 py-1.5 rounded-lg font-mono text-[12px] font-bold uppercase tracking-[0.15em] transition-colors ${
                    pieMode === 'sub'
                      ? 'bg-teal-400/10 text-teal-300 border border-teal-400/30'
                      : 'text-[#5B8A8A] hover:text-[#A8C8C8]'
                  }`}
                >
                  Rubros
                </button>
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
                        style={{ transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)', cursor: 'pointer', opacity: hoverData && hoverData.name !== slice.name ? 0.2 : 1 }}
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
                      <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-[#5B8A8A] mb-1" style={{ maxWidth: '90px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {hoverData.name}
                      </div>
                      <div className="text-2xl font-black" style={{ color: hoverData.color, lineHeight: '1' }}>
                        {hoverData.percentage.toFixed(1)}%
                      </div>
                      <div className="font-mono text-[12px] text-[#A8C8C8] mt-1">{fmtUSD(hoverData.value)}</div>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center' }}>
                      <div className="font-mono text-[12px] text-[#5B8A8A]">Composición</div>
                      <div className="font-mono text-[11px] text-[#3d5a5a] mt-0.5">(Tocar)</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Legend */}
              <div className="flex flex-col gap-1 border-t border-teal-400/10 pt-4 mt-2">
                {pieData.map(item => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between px-2 py-1.5 rounded-lg transition-colors cursor-pointer"
                    style={{ backgroundColor: hoverData && hoverData.name === item.name ? '#0d1f24' : 'transparent' }}
                    onMouseEnter={() => setHoverData(item)}
                    onMouseLeave={() => setHoverData(null)}
                  >
                    <div className="flex items-center gap-2">
                      <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: item.color, flexShrink: 0 }} />
                      <span className="u-legend-name font-mono text-[13px] text-[#A8C8C8]">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="u-legend-val font-mono text-[12px] text-[#5B8A8A]">{fmtUSD(item.value)}</span>
                      <span className="u-legend-pct font-mono text-[13px] font-bold text-[#F0FAFA] min-w-[40px] text-right">{item.percentage.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom nav */}
      <div className="u-bottomnav bg-[#0C1518] border-t border-teal-400/10">
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Brokers</span>
        </Link>
        <Link to="/unificada" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#2DD4BF', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Cartera</span>
        </Link>
        <Link to="/maximos" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Maximos</span>
        </Link>
        <Link to="/rotaciones" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="18" y="3" width="4" height="18"/><rect x="10" y="8" width="4" height="13"/><rect x="2" y="13" width="4" height="8"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Estrategias</span>
        </Link>
        <button onClick={handleLogout} style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1, cursor: 'pointer', padding: 0 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Salir</span>
        </button>
      </div>
    </div>
  );
}
