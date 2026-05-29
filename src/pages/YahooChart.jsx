import { Link, useParams } from 'react-router-dom';
import './YahooChart.css';

const KICKER = "font-mono text-[12px] tracking-[0.22em] uppercase text-teal-400 flex items-center gap-1.5";
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
};

export default function YahooChart() {
  const { symbol = '' } = useParams();
  const cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  const yahooUrl = `https://finance.yahoo.com/chart/${encodeURIComponent(cleanSymbol)}`;
  const tradingViewSymbol = TRADING_VIEW_SYMBOLS[cleanSymbol] || cleanSymbol;
  const tradingViewUrl = `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tradingViewSymbol)}&interval=D&theme=dark&style=1&timezone=America%2FArgentina%2FBuenos_Aires&withdateranges=1&hide_side_toolbar=0&hide_legend=1&allow_symbol_change=1&save_image=0`;

  return (
    <div className="yc-page">
      <div className="yc-header">
        <div>
          <p className={KICKER}>
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2DD4BF]" />
            Grafico historico
          </p>
          <h1>{cleanSymbol}</h1>
          <p className="yc-subtitle">TradingView embebido · Yahoo disponible externo</p>
        </div>
        <div className="yc-actions">
          <Link to="/maximos" className="yc-btn secondary">Volver</Link>
          <a href={yahooUrl} target="_blank" rel="noreferrer" className="yc-btn">Abrir Yahoo</a>
        </div>
      </div>

      <div className="yc-frame-wrap">
        <iframe
          title={`Grafico historico ${cleanSymbol}`}
          src={tradingViewUrl}
          className="yc-frame"
          allowFullScreen
        />
      </div>
    </div>
  );
}
