import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase/config';
import { fetchPortfolioSnapshots, saveDailyPortfolioSnapshot, saveManualPortfolioSnapshot } from '../utils/portfolioSnapshots';
import { useHideBottomNavOnScroll } from '../utils/useHideBottomNavOnScroll';

const KICKER = "font-mono text-[12px] tracking-[0.22em] uppercase text-teal-400 flex items-center gap-1.5";

const handleLogout = async () => {
  sessionStorage.removeItem('bioUnlocked');
  await signOut(auth);
};

const fmtUSD = (v) => 'US$ ' + (v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtARS = (v) => '$ ' + (v || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
const fmtPct = (v) => `${v > 0 ? '+' : ''}${(v || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const RANGE_OPTIONS = [
  { id: '1D', label: '1D' },
  { id: '5D', label: '5D' },
  { id: '30D', label: '30D' },
  { id: '1Y', label: '1A' },
  { id: 'YTM', label: 'YTM' },
];

const dateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const yesterdayKey = () => {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return dateKey(date);
};

const parseInputNumber = (value) => Number(value.toString().replace(/\./g, '').replace(',', '.')) || 0;

const parseSnapshotDate = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const filterSnapshotsByRange = (rows, range) => {
  if (rows.length <= 1) return rows;
  if (range === '1D') return rows.slice(-2);

  const last = rows[rows.length - 1];
  const lastDate = parseSnapshotDate(last.date);
  let startDate;

  if (range === 'YTM') {
    startDate = new Date(lastDate.getFullYear(), 0, 1);
  } else {
    const days = range === '5D' ? 5 : range === '30D' ? 30 : 365;
    startDate = addDays(lastDate, -days);
  }

  const filtered = rows.filter((row) => parseSnapshotDate(row.date) >= startDate);
  if (filtered.length > 1) return filtered;

  const previous = [...rows].reverse().find((row) => parseSnapshotDate(row.date) < startDate);
  return previous ? [previous, ...filtered] : filtered;
};

function EvolutionChart({ rows, currency }) {
  const values = rows.map((row) => currency === 'ARS' ? row.totals?.netArs || 0 : row.totals?.netUsd || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 720;
  const height = 240;
  const pad = 22;
  const points = values.map((value, index) => {
    const x = rows.length === 1 ? width / 2 : pad + (index * (width - pad * 2)) / (rows.length - 1);
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    return { x, y, value, row: rows[index] };
  });
  const d = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

  return (
    <div className="bg-[#122329] border border-teal-400/15 rounded-2xl p-4 overflow-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[220px] sm:h-[260px]" role="img" aria-label="Evolución de cartera">
        <defs>
          <linearGradient id="portfolioLine" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="55%" stopColor="#2DD4BF" />
            <stop offset="100%" stopColor="#FBBF24" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((tick) => {
          const y = pad + tick * ((height - pad * 2) / 3);
          return <line key={tick} x1={pad} x2={width - pad} y1={y} y2={y} stroke="rgba(45,212,191,0.09)" strokeWidth="1" />;
        })}
        <path d={d} fill="none" stroke="url(#portfolioLine)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point) => (
          <g key={point.row.id || point.row.date}>
            <circle cx={point.x} cy={point.y} r="5" fill="#080F12" stroke="#2DD4BF" strokeWidth="3" />
            <title>{`${point.row.date}: ${currency === 'ARS' ? fmtARS(point.value) : fmtUSD(point.value)}`}</title>
          </g>
        ))}
      </svg>
      <div className="flex justify-between gap-3 font-mono text-[11px] tracking-[0.12em] uppercase text-[#5B8A8A]">
        <span>{rows[0]?.date}</span>
        <span>{rows[rows.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export default function PortfolioHistory() {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingBaseline, setSavingBaseline] = useState(false);
  const [currency, setCurrency] = useState('USD');
  const [range, setRange] = useState('30D');
  const [error, setError] = useState('');
  const [baselineDate, setBaselineDate] = useState(() => yesterdayKey());
  const [baselineUsd, setBaselineUsd] = useState('');
  const [baselineMep, setBaselineMep] = useState('');
  const bottomNavHidden = useHideBottomNavOnScroll();

  const loadSnapshots = async () => {
    const rows = await fetchPortfolioSnapshots();
    setSnapshots(rows);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSnapshots()
      .catch(() => setError('No se pudo cargar el historial.'))
      .finally(() => setLoading(false));
  }, []);

  const filteredSnapshots = useMemo(() => filterSnapshotsByRange(snapshots, range), [range, snapshots]);

  const summary = useMemo(() => {
    if (filteredSnapshots.length === 0) return null;
    const first = filteredSnapshots[0];
    const last = filteredSnapshots[filteredSnapshots.length - 1];
    const firstUsd = first.totals?.netUsd || 0;
    const lastUsd = last.totals?.netUsd || 0;
    const firstArs = first.totals?.netArs || 0;
    const lastArs = last.totals?.netArs || 0;

    return {
      first,
      last,
      usdChange: firstUsd > 0 ? ((lastUsd / firstUsd) - 1) * 100 : 0,
      arsChange: firstArs > 0 ? ((lastArs / firstArs) - 1) * 100 : 0,
      count: filteredSnapshots.length,
    };
  }, [filteredSnapshots]);

  const captureToday = async () => {
    setSaving(true);
    setError('');
    try {
      await saveDailyPortfolioSnapshot({ source: 'manual', refreshPrices: true });
      await loadSnapshots();
    } catch (err) {
      setError(`No se pudo guardar la foto diaria: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveBaseline = async () => {
    setSavingBaseline(true);
    setError('');
    try {
      await saveManualPortfolioSnapshot({
        date: baselineDate,
        netUsd: parseInputNumber(baselineUsd),
        mepRate: parseInputNumber(baselineMep),
      });
      setBaselineUsd('');
      await loadSnapshots();
    } catch (err) {
      setError(`No se pudo guardar la referencia: ${err.message}`);
    } finally {
      setSavingBaseline(false);
    }
  };

  return (
    <div className="px-5 pt-8 pb-28 max-w-[920px] mx-auto font-[Space_Grotesk,system-ui,sans-serif] bg-[#080F12] min-h-screen relative overflow-hidden">
      <div className="pointer-events-none absolute top-[-150px] right-[-200px] w-[600px] h-[500px] rounded-full bg-teal-400/[0.04] blur-[100px]" />

      <div className="bg-[#122329] border border-teal-400/15 p-5 rounded-2xl mb-5 shadow-[0_20px_40px_rgba(0,0,0,0.3)] relative z-10">
        <p className={KICKER}>
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2DD4BF]" />
          Historial de Valuación
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3 mt-1">
          <div>
            <h2 className="text-2xl sm:text-4xl font-black tracking-tight text-[#F0FAFA]">Evolución</h2>
            <p className="font-mono text-[12px] tracking-[0.12em] uppercase text-[#5B8A8A] mt-1">
              {snapshots.length} registros diarios · {summary?.count || 0} en vista
            </p>
          </div>
          <button
            onClick={captureToday}
            disabled={saving}
            className="font-mono text-[11px] uppercase tracking-[0.12em] px-4 py-2.5 bg-teal-400 hover:bg-teal-300 text-[#080F12] rounded-lg transition-colors font-bold disabled:opacity-60"
          >
            {saving ? 'Guardando...' : 'Capturar Hoy'}
          </button>
        </div>
      </div>

      <div className="relative z-10">
        {error && (
          <div className="bg-red-400/10 border border-red-400/25 text-red-300 rounded-xl px-4 py-3 font-mono text-[12px] tracking-[0.08em] uppercase mb-4">
            {error}
          </div>
        )}

        <div className="bg-[#122329] border border-teal-400/15 rounded-2xl p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[130px]">
              <label className="block font-mono text-[10px] tracking-[0.18em] uppercase text-[#5B8A8A] mb-1">Fecha</label>
              <input
                type="date"
                value={baselineDate}
                onChange={(event) => setBaselineDate(event.target.value)}
                className="w-full px-3 py-2.5 bg-[#0C1518] border border-teal-400/15 text-[#F0FAFA] rounded-lg text-sm outline-none"
              />
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className="block font-mono text-[10px] tracking-[0.18em] uppercase text-[#5B8A8A] mb-1">Valor USD</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="110000"
                value={baselineUsd}
                onChange={(event) => setBaselineUsd(event.target.value)}
                className="w-full px-3 py-2.5 bg-[#0C1518] border border-teal-400/15 text-[#F0FAFA] rounded-lg text-sm outline-none"
              />
            </div>
            <div className="flex-1 min-w-[130px]">
              <label className="block font-mono text-[10px] tracking-[0.18em] uppercase text-[#5B8A8A] mb-1">MEP opcional</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="1430"
                value={baselineMep}
                onChange={(event) => setBaselineMep(event.target.value)}
                className="w-full px-3 py-2.5 bg-[#0C1518] border border-teal-400/15 text-[#F0FAFA] rounded-lg text-sm outline-none"
              />
            </div>
            <button
              onClick={saveBaseline}
              disabled={savingBaseline}
              className="font-mono text-[11px] uppercase tracking-[0.12em] px-4 py-2.5 bg-teal-400/10 border border-teal-400/20 hover:border-teal-400/50 text-teal-400 rounded-lg transition-colors disabled:opacity-60"
            >
              {savingBaseline ? 'Guardando...' : 'Guardar referencia'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-24">
            <div className="w-10 h-10 border-2 border-[#1e3040] border-t-teal-400 rounded-full animate-spin" />
          </div>
        ) : snapshots.length === 0 ? (
          <div className="bg-[#122329] border border-teal-400/15 rounded-2xl p-8 text-center">
            <p className="font-bold text-[#F0FAFA] mb-2">Todavía no hay registros.</p>
            <p className="font-mono text-[12px] tracking-[0.12em] uppercase text-[#5B8A8A]">Usá Capturar Hoy para crear el primero.</p>
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-3 gap-3 mb-4">
              <div className="bg-[#122329] border border-teal-400/15 rounded-xl p-4">
                <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-[#5B8A8A] mb-1">Valor actual</div>
                <div className="text-2xl font-black text-teal-400">{fmtUSD(summary.last.totals?.netUsd)}</div>
                <div className="font-mono text-[12px] text-[#A8C8C8] mt-1">{fmtARS(summary.last.totals?.netArs)}</div>
              </div>
              <div className="bg-[#122329] border border-teal-400/15 rounded-xl p-4">
                <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-[#5B8A8A] mb-1">Variación USD</div>
                <div className={`text-2xl font-black ${summary.usdChange >= 0 ? 'text-teal-300' : 'text-red-300'}`}>{fmtPct(summary.usdChange)}</div>
                <div className="font-mono text-[12px] text-[#5B8A8A] mt-1">desde {summary.first.date}</div>
              </div>
              <div className="bg-[#122329] border border-teal-400/15 rounded-xl p-4">
                <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-[#5B8A8A] mb-1">Variación ARS</div>
                <div className={`text-2xl font-black ${summary.arsChange >= 0 ? 'text-teal-300' : 'text-red-300'}`}>{fmtPct(summary.arsChange)}</div>
                <div className="font-mono text-[12px] text-[#5B8A8A] mt-1">MEP {fmtARS(summary.last.rates?.mep)}</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-4">
              <div className="flex bg-[#0C1518] border border-teal-400/10 rounded-lg p-0.5 w-fit">
                {['USD', 'ARS'].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setCurrency(mode)}
                    className={`px-4 py-1.5 rounded-md font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${currency === mode ? 'bg-teal-400/10 text-teal-300 border border-teal-400/30' : 'text-[#5B8A8A]'}`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <div className="flex bg-[#0C1518] border border-teal-400/10 rounded-lg p-0.5 w-fit">
                {RANGE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setRange(option.id)}
                    className={`px-3 py-1.5 rounded-md font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${range === option.id ? 'bg-teal-400/10 text-teal-300 border border-teal-400/30' : 'text-[#5B8A8A]'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <EvolutionChart rows={filteredSnapshots} currency={currency} />

            <div className="bg-[#122329] border border-teal-400/15 rounded-2xl overflow-hidden mt-4">
              {filteredSnapshots.slice().reverse().map((row) => (
                <div key={row.id || row.date} className="grid grid-cols-[1fr_auto] sm:grid-cols-[140px_1fr_1fr_100px] gap-3 items-center px-4 py-3 border-b border-teal-400/5 last:border-b-0">
                  <div className="font-mono text-[13px] font-bold text-[#F0FAFA]">{row.date}</div>
                  <div className="text-right sm:text-left font-bold text-teal-300">{fmtUSD(row.totals?.netUsd)}</div>
                  <div className="hidden sm:block font-mono text-[13px] text-[#A8C8C8]">{fmtARS(row.totals?.netArs)}</div>
                  <div className="hidden sm:block text-right font-mono text-[12px] text-[#5B8A8A]">{fmtARS(row.rates?.mep)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className={`fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[920px] bg-[#0C1518] border-t border-teal-400/10 flex justify-around px-2 pt-3 pb-6 z-[1000] transition-[transform,opacity] duration-300 ease-out ${bottomNavHidden ? 'translate-y-full opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'}`}>
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span className="font-mono text-[9px] tracking-[0.08em] uppercase">Brokers</span>
        </Link>
        <Link to="/unificada" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
          <span className="font-mono text-[9px] tracking-[0.08em] uppercase">Cartera</span>
        </Link>
        <Link to="/evolucion" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#2DD4BF', flex: 1 }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>
          <span className="font-mono text-[9px] tracking-[0.08em] uppercase">Evolución</span>
        </Link>
        <button onClick={handleLogout} style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1, cursor: 'pointer', padding: 0 }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span className="font-mono text-[9px] tracking-[0.08em] uppercase">Salir</span>
        </button>
      </div>
    </div>
  );
}
