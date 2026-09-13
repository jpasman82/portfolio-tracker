import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import AppBottomNav from '../components/AppBottomNav';
import LogoutButton from '../components/LogoutButton';
import { fetchAllPrices, getCclRate } from '../utils/priceService';
import { fetchGoogleFinanceQuotes } from '../utils/googleFinanceService';
import { preciosMaximosLocalesUSD } from '../utils/maximosData';
import { assetDictionary } from '../utils/dictionary';
import { esMercadoAbierto } from '../utils/marketHours';
import { useHideBottomNavOnScroll } from '../utils/useHideBottomNavOnScroll';
import { parseNum } from '../utils/numberFormat';
import './Maximos.css';

const KICKER = "font-mono text-[12px] tracking-[0.22em] uppercase text-teal-400 flex items-center gap-1.5";
const YAHOO_SYMBOLS = {
  TGSU2: 'TGS',
  YPFD: 'YPF',
  TECO2: 'TEO',
};
const TRADING_VIEW_SYMBOLS = {
  BBAR: 'NYSE:BBAR',
  BMA: 'NYSE:BMA',
  TGS: 'NYSE:TGS',
  YPF: 'NYSE:YPF',
  TEO: 'NYSE:TEO',
  PAMP: 'NYSE:PAM',
  CEPU: 'NYSE:CEPU',
  GGAL: 'NASDAQ:GGAL',
  SUPV: 'NYSE:SUPV',
  EDN: 'NYSE:EDN',
  GLOB: 'NYSE:GLOB',
  VIST: 'NYSE:VIST',
  XP: 'NASDAQ:XP',
  NU: 'NYSE:NU',
  PAX: 'NASDAQ:PAX',
  VALE: 'NYSE:VALE',
  ITUB: 'NYSE:ITUB',
  EWZ: 'AMEX:EWZ',
};

const tradingViewUrl = (symbol, range) => {
  const tvSymbol = TRADING_VIEW_SYMBOLS[symbol] || symbol;
  return `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tvSymbol)}&interval=W&range=${range}&theme=dark&style=2&timezone=America%2FArgentina%2FBuenos_Aires&hide_top_toolbar=1&hide_side_toolbar=1&hide_legend=1&allow_symbol_change=0&save_image=0`;
};

export default function Maximos() {
  const [target, setTarget] = useState('enero');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mercadoAbierto, setMercadoAbierto] = useState(() => esMercadoAbierto());
  const bottomNavHidden = useHideBottomNavOnScroll();

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
        const mercadoEstaAbierto = esMercadoAbierto();
        setMercadoAbierto(mercadoEstaAbierto);
        // BYMA devuelve closing_price / previous_close tambien con el mercado cerrado:
        // pedimos siempre y fuera de horario quedan los precios del ultimo cierre.
        const priceMap = await fetchAllPrices();
        const googleFinanceItems = preciosMaximosLocalesUSD
          .filter((item) => item.priceSource === 'googleFinance')
          .map((item) => ({
            ticker: item.ticker,
            symbol: item.googleFinanceSymbol || item.ticker,
            exchange: item.googleFinanceExchange || 'NASDAQ',
          }));
        const googleFinancePrices = await fetchGoogleFinanceQuotes(googleFinanceItems);
        const cableRate = getCclRate();
        const maxTickers = new Set(preciosMaximosLocalesUSD.map((item) => item.ticker));
        const holdingsByTicker = {};

        const positionsSnap = await getDocs(collection(db, "brokerPositions"));
        positionsSnap.forEach((doc) => {
          const data = doc.data();
          (data.assets || []).forEach((asset) => {
            const ticker = asset.ticker?.toUpperCase().trim();
            if (!ticker || !maxTickers.has(ticker)) return;
            holdingsByTicker[ticker] = (holdingsByTicker[ticker] || 0) + parseNum(asset.quantity);
          });
        });

        const nextRows = preciosMaximosLocalesUSD.map((item) => {
          const googleFinanceQuote = googleFinancePrices[item.ticker] || null;
          const usesGoogleFinance = item.priceSource === 'googleFinance';
          const localARS = usesGoogleFinance ? null : priceMap[item.ticker] ?? null;
          const localUSD = usesGoogleFinance
            ? googleFinanceQuote?.price ? googleFinanceQuote.price / item.ratioADR : null
            : localARS && cableRate ? localARS / cableRate : null;
          const adrEquiv = usesGoogleFinance
            ? googleFinanceQuote?.price ?? null
            : localUSD !== null ? localUSD * item.ratioADR : null;
          const holdingQty = holdingsByTicker[item.ticker] || 0;
          const holdingUsd = localUSD !== null ? holdingQty * localUSD : 0;
          const dictInfo = assetDictionary[item.ticker] || (item.ticker === 'VIST' ? { cat: 'Acciones', sub: 'Energia' } : null);
          const maxHistoricoDistance = adrEquiv !== null ? ((adrEquiv / item.maxHistoricoADR) - 1) * 100 : null;
          const maxHistoricoReturn = adrEquiv !== null ? ((item.maxHistoricoADR / adrEquiv) - 1) * 100 : null;
          const maxEneroDistance = adrEquiv !== null ? ((adrEquiv / item.maxEnero2025ADR) - 1) * 100 : null;
          const maxEneroReturn = adrEquiv !== null ? ((item.maxEnero2025ADR / adrEquiv) - 1) * 100 : null;

          return {
            ...item,
            localARS,
            localUSD,
            adrEquiv,
            holdingQty,
            holdingUsd,
            yahooSymbol: YAHOO_SYMBOLS[item.ticker] || item.ticker,
            rubro: dictInfo?.sub || 'Sin clasificar',
            priceSourceLabel: usesGoogleFinance ? 'Google Finance' : null,
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
    return [...rows].sort((a, b) => (b.holdingUsd || 0) - (a.holdingUsd || 0));
  }, [rows]);

  const groupedRows = useMemo(() => {
    return sortedRows.reduce((groups, row) => {
      if (!groups[row.rubro]) groups[row.rubro] = [];
      groups[row.rubro].push(row);
      return groups;
    }, {});
  }, [sortedRows]);

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
          {!mercadoAbierto && <span className="text-[#5B8A8A] normal-case tracking-normal ml-1">- precios al cierre</span>}
        </p>
        <div className="m-title-row">
          <h2 className="m-title text-2xl font-bold tracking-tight text-[#F0FAFA] mt-1">Maximos</h2>
          <div className="m-switch">
          <button className={target === 'enero' ? 'active' : ''} onClick={() => setTarget('enero')}>Ene 2025</button>
          <button className={target === 'historico' ? 'active' : ''} onClick={() => setTarget('historico')}>Historico</button>
          </div>
          <LogoutButton />
        </div>
      </div>

      <div className="m-table-card relative z-10">
        <div className="m-row m-table-head">
          <span>Ticker</span>
          <span>Tenencia USD</span>
          <span>Actual USD</span>
          <span>Max local USD</span>
          <span>ADR equiv.</span>
          <span>Max ADR</span>
          <span>Falta a max.</span>
        </div>

        {Object.entries(groupedRows).map(([rubro, rubroRows]) => (
          <div key={rubro} className="m-rubro-group">
            <div className="m-rubro-head">
              <span>{rubro}</span>
              <strong>{fmtUSD(rubroRows.reduce((sum, row) => sum + (row.holdingUsd || 0), 0), 0)}</strong>
            </div>
            {rubroRows.map((row) => {
              const maxADR = target === 'historico' ? row.maxHistoricoADR : row.maxEnero2025ADR;
              const maxLocal = target === 'historico' ? row.maxHistoricoLocalUSD : row.maxEnero2025LocalUSD;
              const needed = target === 'historico' ? row.maxHistoricoReturn : row.maxEneroReturn;
              const isAbove = needed !== null && needed <= 0;
              const chartRange = target === 'historico' ? 'ALL' : '60M';

              return (
                <div key={row.ticker} className="m-row-card">
                  <div className="m-row m-row-mobile">
                    <div>
                      <strong className="m-ticker">{row.ticker}</strong>
                      <span className="m-ratio">{row.ratioADR} local / ADR · {row.yahooSymbol}{row.priceSourceLabel ? ` · ${row.priceSourceLabel}` : ''}</span>
                    </div>
                    <span className="m-holding-usd"><small>Tenencia</small>{fmtUSD(row.holdingUsd, 0)}</span>
                    <span className="m-current-local"><small>{row.priceSourceLabel ? 'Actual USD' : 'Actual local'}</small>{fmtUSD(row.localUSD, 2)}</span>
                    <span className="m-max-local"><small>Max local</small>{fmtUSD(maxLocal, 2)}</span>
                    <span className="m-adr-equiv"><small>ADR actual</small>{fmtUSD(row.adrEquiv, 2)}</span>
                    <span className="m-max-adr"><small>Max ADR</small>{fmtUSD(maxADR, 2)}</span>
                    <span className={`m-needed ${isAbove ? 'm-positive' : 'm-negative'}`}><small>Falta a max.</small>{fmtPct(needed)}</span>
                  </div>
                  <Link
                    to={`/yahoo/${encodeURIComponent(row.yahooSymbol)}`}
                    className="m-row m-row-desktop m-row-link"
                    aria-label={`Abrir grafico historico de ${row.yahooSymbol}`}
                  >
                    <div>
                      <strong className="m-ticker">{row.ticker}</strong>
                      <span className="m-ratio">{row.ratioADR} local / ADR · {row.yahooSymbol}{row.priceSourceLabel ? ` · ${row.priceSourceLabel}` : ''}</span>
                    </div>
                    <span className="m-holding-usd"><small>Tenencia</small>{fmtUSD(row.holdingUsd, 0)}</span>
                    <span className="m-current-local"><small>{row.priceSourceLabel ? 'Actual USD' : 'Actual local'}</small>{fmtUSD(row.localUSD, 2)}</span>
                    <span className="m-max-local"><small>Max local</small>{fmtUSD(maxLocal, 2)}</span>
                    <span className="m-adr-equiv"><small>ADR actual</small>{fmtUSD(row.adrEquiv, 2)}</span>
                    <span className="m-max-adr"><small>Max ADR</small>{fmtUSD(maxADR, 2)}</span>
                    <span className={`m-needed ${isAbove ? 'm-positive' : 'm-negative'}`}><small>Falta a max.</small>{fmtPct(needed)}</span>
                  </Link>
                  <div className="m-mobile-chart" aria-label={`Evolucion 5 anos de ${row.yahooSymbol}`}>
                    <iframe
                      title={`Grafico ${target === 'historico' ? 'historico' : '5 anos'} ${row.yahooSymbol}`}
                      src={tradingViewUrl(row.yahooSymbol, chartRange)}
                      loading="lazy"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <AppBottomNav hidden={bottomNavHidden} />
    </div>
  );
}
