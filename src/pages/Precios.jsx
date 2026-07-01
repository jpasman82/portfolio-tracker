import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { fetchAllPrices, getPriceRows, getMepRate } from '../utils/priceService';
import { useHideBottomNavOnScroll } from '../utils/useHideBottomNavOnScroll';

const KICKER = "font-mono text-[12px] tracking-[0.22em] uppercase text-teal-400 flex items-center gap-1.5";

const handleLogout = async () => {
  sessionStorage.removeItem('bioUnlocked');
  await signOut(auth);
};

export default function Precios() {
  const [rows, setRows] = useState([]);
  const [portfolioTickers, setPortfolioTickers] = useState(new Set());
  const [viewMode, setViewMode] = useState('portfolio');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState({ key: 'changePercent', dir: 'asc' });
  const bottomNavHidden = useHideBottomNavOnScroll();

  useEffect(() => {
    const loadPrices = async () => {
      try {
        setError('');
        const positionsSnap = await getDocs(collection(db, 'brokerPositions'));
        const tickers = new Set();
        positionsSnap.forEach((document) => {
          (document.data().assets || []).forEach((asset) => {
            const ticker = asset.ticker?.toUpperCase().trim();
            if (ticker) tickers.add(ticker);
          });
        });

        await fetchAllPrices();
        setPortfolioTickers(tickers);
        setRows(getPriceRows());
      } catch (e) {
        setError('No se pudieron cargar los precios.');
      } finally {
        setLoading(false);
      }
    };
    loadPrices();
  }, []);

  const visibleRows = useMemo(() => {
    if (viewMode === 'all') return rows;
    return rows.filter((row) => portfolioTickers.has(row.ticker));
  }, [portfolioTickers, rows, viewMode]);

  const sortedRows = useMemo(() => {
    const direction = sort.dir === 'asc' ? 1 : -1;
    return [...visibleRows].sort((a, b) => {
      if (sort.key === 'ticker') {
        return a.ticker.localeCompare(b.ticker) * direction;
      }
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return (av - bv) * direction;
    });
  }, [visibleRows, sort]);

  const setSortKey = (key) => {
    setSort((current) => ({
      key,
      dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortMark = (key) => {
    if (sort.key !== key) return '';
    return sort.dir === 'asc' ? ' ▲' : ' ▼';
  };

  const fmtUSD = (v) => {
    if (v === null || v === undefined) return '-';
    return 'USD ' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const fmtPct = (v) => {
    if (v === null || v === undefined) return '-';
    return `${v > 0 ? '+' : ''}${v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  };

  const fmtChange = (v) => {
    if (v === null || v === undefined) return '';
    return `${v > 0 ? '+' : ''}${v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="px-3 sm:px-5 pt-6 pb-28 max-w-[900px] mx-auto font-[Space_Grotesk,system-ui,sans-serif] bg-[#080F12] min-h-screen relative overflow-hidden">
      <div className="pointer-events-none absolute top-[-150px] right-[-200px] w-[600px] h-[500px] rounded-full bg-teal-400/[0.04] blur-[100px]" />

      <div className="bg-[#122329] border border-teal-400/15 p-4 sm:p-5 rounded-2xl mb-4 shadow-[0_20px_40px_rgba(0,0,0,0.3)] relative z-10">
        <p className={KICKER}>
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2DD4BF]" />
          Mercado BYMA
        </p>
        <div className="flex justify-between items-end gap-3 mt-1">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-[#F0FAFA]">Precios</h2>
            <p className="font-mono text-[11px] tracking-[0.12em] uppercase text-[#5B8A8A] mt-1">
              {visibleRows.length} especies · MEP {getMepRate() ? `$ ${getMepRate().toLocaleString('es-AR', { maximumFractionDigits: 2 })}` : '-'}
            </p>
          </div>
          <button
            onClick={() => setSort({ key: 'changePercent', dir: 'asc' })}
            className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 bg-teal-400/10 border border-teal-400/20 hover:border-teal-400/50 text-teal-400 rounded-lg transition-colors"
          >
            Bajas
          </button>
        </div>
        <div className="flex bg-[#0C1518] border border-teal-400/10 rounded-lg p-0.5 mt-4 w-fit">
          <button
            onClick={() => setViewMode('portfolio')}
            className={`px-3 py-1.5 rounded-md font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${viewMode === 'portfolio' ? 'bg-teal-400/10 text-teal-300 border border-teal-400/30' : 'text-[#5B8A8A]'}`}
          >
            En cartera
          </button>
          <button
            onClick={() => setViewMode('all')}
            className={`px-3 py-1.5 rounded-md font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${viewMode === 'all' ? 'bg-teal-400/10 text-teal-300 border border-teal-400/30' : 'text-[#5B8A8A]'}`}
          >
            Todos
          </button>
        </div>
      </div>

      <div className="bg-[#122329] border border-teal-400/15 rounded-2xl overflow-hidden relative z-10">
        <div className="grid grid-cols-[minmax(82px,1fr)_86px_92px] sm:grid-cols-[minmax(140px,1fr)_120px_120px_100px] items-center bg-[#0C1518] border-b border-teal-400/10 sticky top-0 z-20">
          <button onClick={() => setSortKey('ticker')} className="text-left px-3 py-3 bg-transparent border-none font-mono text-[11px] tracking-[0.14em] uppercase text-[#5B8A8A] cursor-pointer">
            Especie{sortMark('ticker')}
          </button>
          <button onClick={() => setSortKey('priceUsd')} className="text-right px-2 py-3 bg-transparent border-none font-mono text-[11px] tracking-[0.14em] uppercase text-[#5B8A8A] cursor-pointer">
            Precio{sortMark('priceUsd')}
          </button>
          <button onClick={() => setSortKey('changePercent')} className="text-right px-3 py-3 bg-transparent border-none font-mono text-[11px] tracking-[0.14em] uppercase text-[#5B8A8A] cursor-pointer">
            Var.{sortMark('changePercent')}
          </button>
          <div className="hidden sm:block text-right px-3 py-3 font-mono text-[11px] tracking-[0.14em] uppercase text-[#5B8A8A]">
            USD
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-20">
            <div className="w-9 h-9 border-2 border-[#1e3040] border-t-teal-400 rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="px-4 py-10 text-center text-red-300 font-mono text-[13px] tracking-[0.12em] uppercase">{error}</div>
        ) : sortedRows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[#5B8A8A] font-mono text-[13px] tracking-[0.12em] uppercase">
            {viewMode === 'portfolio' ? 'Sin especies en cartera con precio disponible' : 'Sin precios disponibles'}
          </div>
        ) : (
          <div className="divide-y divide-teal-400/5">
            {sortedRows.map((row) => {
              const positive = row.changePercent > 0;
              const negative = row.changePercent < 0;
              const color = positive ? 'text-teal-300' : negative ? 'text-red-300' : 'text-[#A8C8C8]';
              return (
                <div key={`${row.ticker}-${row.market}`} className="grid grid-cols-[minmax(82px,1fr)_86px_92px] sm:grid-cols-[minmax(140px,1fr)_120px_120px_100px] items-center hover:bg-teal-400/[0.03] transition-colors">
                  <div className="px-3 py-2 min-w-0">
                    <div className="font-mono text-[14px] sm:text-[15px] font-black text-[#F0FAFA] truncate">{row.ticker}</div>
                    <div className="font-mono text-[9px] sm:text-[10px] tracking-[0.12em] uppercase text-[#5B8A8A] truncate">{row.type} · {row.market}</div>
                  </div>
                  <div className="px-2 py-2 text-right font-mono text-[12px] sm:text-[13px] font-bold text-[#A8C8C8] whitespace-nowrap">
                    {fmtUSD(row.priceUsd)}
                  </div>
                  <div className={`px-3 py-2 text-right font-mono text-[13px] sm:text-[14px] font-black whitespace-nowrap ${color}`}>
                    {fmtPct(row.changePercent)}
                  </div>
                  <div className={`hidden sm:block px-3 py-2 text-right font-mono text-[12px] font-bold whitespace-nowrap ${color}`}>
                    {fmtChange(row.changeUsd)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={`fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[900px] bg-[#0C1518] border-t border-teal-400/10 flex justify-around px-2 pt-3 pb-6 z-[1000] transition-[transform,opacity] duration-300 ease-out ${bottomNavHidden ? 'translate-y-full opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'}`}>
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span className="font-mono text-[9px] tracking-[0.08em] uppercase">Brokers</span>
        </Link>
        <Link to="/unificada" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
          <span className="font-mono text-[9px] tracking-[0.08em] uppercase">Cartera</span>
        </Link>
        <Link to="/precios" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#2DD4BF', flex: 1 }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 15l3-3 3 2 5-7"/></svg>
          <span className="font-mono text-[9px] tracking-[0.08em] uppercase">Precios</span>
        </Link>
        <Link to="/maximos" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>
          <span className="font-mono text-[9px] tracking-[0.08em] uppercase">Maximos</span>
        </Link>
        <Link to="/rotaciones" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="18" y="3" width="4" height="18"/><rect x="10" y="8" width="4" height="13"/><rect x="2" y="13" width="4" height="8"/></svg>
          <span className="font-mono text-[9px] tracking-[0.08em] uppercase">Estrategias</span>
        </Link>
        <button onClick={handleLogout} style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1, cursor: 'pointer', padding: 0 }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span className="font-mono text-[9px] tracking-[0.08em] uppercase">Salir</span>
        </button>
      </div>
    </div>
  );
}
