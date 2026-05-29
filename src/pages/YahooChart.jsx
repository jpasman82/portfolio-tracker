import { Link, useParams } from 'react-router-dom';
import './YahooChart.css';

const KICKER = "font-mono text-[12px] tracking-[0.22em] uppercase text-teal-400 flex items-center gap-1.5";

export default function YahooChart() {
  const { symbol = '' } = useParams();
  const cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  const yahooUrl = `https://finance.yahoo.com/chart/${encodeURIComponent(cleanSymbol)}`;

  return (
    <div className="yc-page">
      <div className="yc-header">
        <div>
          <p className={KICKER}>
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2DD4BF]" />
            Yahoo Finance
          </p>
          <h1>{cleanSymbol}</h1>
        </div>
        <div className="yc-actions">
          <Link to="/maximos" className="yc-btn secondary">Volver</Link>
          <a href={yahooUrl} target="_blank" rel="noreferrer" className="yc-btn">Abrir Yahoo</a>
        </div>
      </div>

      <div className="yc-frame-wrap">
        <iframe
          title={`Yahoo Finance ${cleanSymbol}`}
          src={yahooUrl}
          className="yc-frame"
        />
      </div>
    </div>
  );
}
