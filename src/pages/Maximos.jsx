import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase/config';
import { fetchAllPrices, getCclRate } from '../utils/priceService';
import { preciosMaximosLocalesUSD } from '../utils/maximosData';
import './Maximos.css';

const KICKER = "font-mono text-[12px] tracking-[0.22em] uppercase text-teal-400 flex items-center gap-1.5";

const handleLogout = async () => {
  sessionStorage.removeItem('bioUnlocked');
  await signOut(auth);
};

export default function Maximos() {
  const [target, setTarget] = useState('historico');
  const [rows, setRows] = useState([]);
  const [cable, setCable] = useState(null);
  const [loading, setLoading] = useState(true);

  const fmtUSD = (v, digits = 2) => {
    if (v === null || v === undefined || Number.isNaN(v)) return '-';
    return 'US$ ' + Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };
  const fmtPct = (v) => {
    if (v === null || v === undefined || Number.isNaN(v)) return '-';
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const priceMap = await fetchAllPrices();
        const cableRate = getCclRate();
        setCable(cableRate);

        const nextRows = preciosMaximosLocalesUSD.map((item) => {
          const localARS = priceMap[item.ticker] ?? null;
          const localUSD = localARS && cableRate ? localARS / cableRate : null;
          const adrEquiv = localUSD !== null ? localUSD * item.ratioADR : null;
          const maxHistoricoDistance = adrEquiv !== null ? ((adrEquiv / item.maxHistoricoADR) - 1) * 100 : null;
          const maxHistoricoReturn = adrEquiv !== null ? ((item.maxHistoricoADR / adrEquiv) - 1) * 100 : null;
          const maxEneroDistance = adrEquiv !== null ? ((adrEquiv / item.maxEnero2025ADR) - 1) * 100 : null;
          const maxEneroReturn = adrEquiv !== null ? ((item.maxEnero2025ADR / adrEquiv) - 1) * 100 : null;

          return {
            ...item,
            localARS,
            localUSD,
            adrEquiv,
            maxHistoricoDistance,
            maxHistoricoReturn,
            maxEneroDistance,
            maxEneroReturn,
          };
        });

        setRows(nextRows);
      } catch (e) {
        console.error('[Maximos]', e.message);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const sortedRows = useMemo(() => {
    const distanceKey = target === 'historico' ? 'maxHistoricoDistance' : 'maxEneroDistance';
    return [...rows].sort((a, b) => {
      const av = a[distanceKey] ?? -Infinity;
      const bv = b[distanceKey] ?? -Infinity;
      return bv - av;
    });
  }, [rows, target]);

  const summary = useMemo(() => {
    const returnKey = target === 'historico' ? 'maxHistoricoReturn' : 'maxEneroReturn';
    const valid = sortedRows.filter((r) => r[returnKey] !== null && r[returnKey] !== undefined);
    if (!valid.length) return { above: 0, avgReturn: null, closest: null };

    const above = valid.filter((r) => r[returnKey] <= 0).length;
    const avgReturn = valid.reduce((sum, r) => sum + r[returnKey], 0) / valid.length;
    const closest = [...valid].sort((a, b) => Math.abs(a[returnKey]) - Math.abs(b[returnKey]))[0];
    return { above, avgReturn, closest };
  }, [sortedRows, target]);

  if (loading) return (
    <div className="m-page flex justify-center items-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-[#1e3040] border-t-teal-400 rounded-full animate-spin" />
        <p className="font-mono text-[13px] tracking-[0.22em] uppercase text-[#5B8A8A] animate-pulse">Calculando maximos...</p>
      </div>
    </div>
  );

  return (
    <div className="m-page">
      <div className="pointer-events-none absolute top-[-150px] right-[-200px] w-[600px] h-[500px] rounded-full bg-teal-400/[0.04] blur-[100px]" />

      <div className="m-header bg-[#122329] border border-teal-400/15 p-5 rounded-2xl mb-5 shadow-[0_20px_40px_rgba(0,0,0,0.3)] relative z-10">
        <p className={KICKER}>
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2DD4BF]" />
          Comparacion contra techos
        </p>
        <div className="m-title-row">
          <h2 className="m-title text-2xl font-bold tracking-tight text-[#F0FAFA] mt-1">Maximos</h2>
          <div className="m-switch">
            <button className={target === 'historico' ? 'active' : ''} onClick={() => setTarget('historico')}>Historico</button>
            <button className={target === 'enero' ? 'active' : ''} onClick={() => setTarget('enero')}>Ene 2025</button>
          </div>
        </div>
        <p className="font-mono text-[13px] tracking-[0.15em] uppercase text-[#5B8A8A] mt-1.5">
          Precio local BYMA / cable, llevado a referencia ADR
        </p>
      </div>

      <div className="m-summary-grid relative z-10">
        <div className="m-summary-card">
          <span>Cable usado</span>
          <strong>{cable ? '$ ' + cable.toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '-'}</strong>
        </div>
        <div className="m-summary-card">
          <span>Arriba del maximo</span>
          <strong>{summary.above}/{rows.length}</strong>
        </div>
        <div className="m-summary-card">
          <span>Promedio para volver</span>
          <strong className={summary.avgReturn <= 0 ? 'm-positive' : 'm-negative'}>{fmtPct(summary.avgReturn)}</strong>
        </div>
        <div className="m-summary-card">
          <span>Mas cerca</span>
          <strong>{summary.closest?.ticker ?? '-'}</strong>
        </div>
      </div>

      <div className="m-table-card relative z-10">
        <div className="m-row m-table-head">
          <span>Ticker</span>
          <span>Local USD</span>
          <span>ADR equiv.</span>
          <span>Max ref.</span>
          <span>Dist.</span>
          <span>Para volver</span>
        </div>

        {sortedRows.map((row) => {
          const maxADR = target === 'historico' ? row.maxHistoricoADR : row.maxEnero2025ADR;
          const maxLocal = target === 'historico' ? row.maxHistoricoLocalUSD : row.maxEnero2025LocalUSD;
          const distance = target === 'historico' ? row.maxHistoricoDistance : row.maxEneroDistance;
          const needed = target === 'historico' ? row.maxHistoricoReturn : row.maxEneroReturn;
          const isAbove = needed !== null && needed <= 0;

          return (
            <div key={row.ticker} className="m-row">
              <div>
                <strong className="m-ticker">{row.ticker}</strong>
                <span className="m-ratio">{row.ratioADR} local / ADR</span>
              </div>
              <span>{fmtUSD(row.localUSD, 2)}</span>
              <span>{fmtUSD(row.adrEquiv, 2)}</span>
              <span>
                <strong>{fmtUSD(maxADR, 2)}</strong>
                <small>{fmtUSD(maxLocal, 2)} local</small>
              </span>
              <span className={isAbove ? 'm-positive' : 'm-negative'}>{fmtPct(distance)}</span>
              <span className={isAbove ? 'm-positive' : 'm-negative'}>{fmtPct(needed)}</span>
            </div>
          );
        })}
      </div>

      <div className="m-bottomnav bg-[#0C1518] border-t border-teal-400/10">
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Brokers</span>
        </Link>
        <Link to="/unificada" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Cartera</span>
        </Link>
        <Link to="/maximos" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#2DD4BF', flex: 1 }}>
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
