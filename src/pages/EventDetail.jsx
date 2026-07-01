import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { fetchAllPrices, getMepRate } from '../utils/priceService';
import { esMercadoAbierto } from '../utils/marketHours';

const KICKER = "font-mono text-[12px] tracking-[0.22em] uppercase text-teal-400 flex items-center gap-1.5";
const INPUT = "w-full px-3 py-2.5 bg-[#0C1518] border border-teal-400/15 hover:border-teal-400/30 focus:border-teal-400/60 text-[#F0FAFA] placeholder-[#3d5a5a] rounded-xl text-sm outline-none transition-colors box-border";
const INPUT_TEAL = "w-full px-3 py-2.5 bg-teal-400/5 border border-teal-400/20 hover:border-teal-400/40 focus:border-teal-400/60 text-teal-300 rounded-xl text-sm outline-none transition-colors box-border text-right";
const LABEL = "font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A] block mb-1.5";
const BOX_READ = "w-full px-3 bg-[#0C1518] border border-teal-400/10 rounded-xl text-sm font-bold text-[#A8C8C8] box-border flex items-center justify-end h-[42px] overflow-hidden";
const BOX_READ_TEAL = "w-full px-3 bg-teal-400/5 border border-teal-400/20 rounded-xl text-sm font-bold text-teal-300 box-border flex items-center justify-end h-[42px] overflow-hidden";

export default function EventDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditingStructure, setIsEditingStructure] = useState(false);
  const [advancedEditIndex, setAdvancedEditIndex] = useState(null);
  const [currentAssets, setCurrentAssets] = useState([]);
  const [currentPrices, setCurrentPrices] = useState({});
  const [soldCurrentPrices, setSoldCurrentPrices] = useState({});
  const [currentUsdRate, setCurrentUsdRate] = useState('');
  const [eventName, setEventName] = useState('');
  const [saving, setSaving] = useState(false);
  const [viewCurrency, setViewCurrency] = useState('USD');

  const formatInput = (val) => {
    if (val === undefined || val === null || val === '') return '';
    let str = val.toString();
    if (typeof val === 'number' || (str.includes('.') && !str.includes(','))) str = str.replace(/\./g, ',');
    let clean = str.replace(/[^0-9,]/g, '');
    let parts = clean.split(',');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    if (parts.length > 2) parts = [parts[0], parts.slice(1).join('')];
    return parts.join(',');
  };

  const parseNum = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    return Number(val.toString().replace(/\./g, '').replace(',', '.')) || 0;
  };

  const formatDecimals = (val) => parseNum(val).toFixed(2).replace('.', ',');
  const fmtQty = (v) => formatInput(v);
  const fmtARS = (v) => '$ ' + formatInput(typeof v === 'number' ? v.toFixed(2) : v);
  const fmtUSD = (v) => 'USD ' + formatInput(typeof v === 'number' ? v.toFixed(2) : v);
  const fmtSignedARS = (v) => `${parseNum(v) >= 0 ? '+' : '-'} ${fmtARS(Math.abs(parseNum(v)))}`;
  const fmtSignedUSD = (v) => `${parseNum(v) >= 0 ? '+' : '-'} ${fmtUSD(Math.abs(parseNum(v)))}`;

  useEffect(() => {
    const fetchData = async () => {
      try {
        const docSnap = await getDoc(doc(db, "rotations", id));
        if (docSnap.exists()) {
          const data = docSnap.data();
          let priceMap = {};
          let mepRate = null;
          if (!data.isClosed && esMercadoAbierto()) {
            try {
              priceMap = await fetchAllPrices();
              mepRate = getMepRate();
            } catch (e) {
              console.error('[EventDetail] BYMA prices:', e.message);
            }
          }
          setEvent(data);
          setEventName(data.eventName);
          const initUsd = mepRate || data.currentUsdRateFromDb || data.initialUsdRate || 1;
          setCurrentUsdRate(formatDecimals(initUsd));
          const assets = data.boughtAssetsFromDb || data.boughtAssets || [];
          const formattedAssets = assets.map(a => ({
            ...a,
            quantity: a.quantity?.toString().replace('.', ',') || '',
            priceAtTrade: formatDecimals(a.priceAtTrade),
            usdRateAtTrade: formatDecimals(a.usdRateAtTrade || data.initialUsdRate || initUsd)
          }));
          setCurrentAssets(formattedAssets);
          const pB = {};
          formattedAssets.forEach(a => {
            const t = a.ticker?.toUpperCase().trim();
            pB[a.ticker] = formatDecimals(priceMap[t] ?? data.currentPricesFromDb?.[a.ticker] ?? a.priceAtTrade ?? 0);
          });
          setCurrentPrices(pB);
          const pS = {};
          (data.soldAssets || []).forEach(a => {
            const t = a.ticker?.toUpperCase().trim();
            pS[a.ticker] = formatDecimals(priceMap[t] ?? data.soldCurrentPricesFromDb?.[a.ticker] ?? a.priceAtTrade ?? 0);
          });
          setSoldCurrentPrices(pS);
        }
      } catch (e) {}
      finally { setLoading(false); }
    };
    fetchData();
  }, [id]);

  const handleAddAsset = () => {
    setCurrentAssets([...currentAssets, { ticker: '', quantity: '', priceAtTrade: '', usdRateAtTrade: currentUsdRate }]);
  };

  const handleRemoveAsset = (index) => setCurrentAssets(currentAssets.filter((_, i) => i !== index));

  const toggleEditStructure = () => {
    setIsEditingStructure(!isEditingStructure);
    if (isEditingStructure) setAdvancedEditIndex(null);
  };

  const save = async (closeValue) => {
    setSaving(true);
    const now = new Date();
    const timestamp = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const cleanAssets = currentAssets.map(a => ({
      ...a,
      quantity: parseNum(a.quantity),
      priceAtTrade: parseNum(a.priceAtTrade),
      usdRateAtTrade: parseNum(a.usdRateAtTrade) || parseNum(currentUsdRate)
    }));
    const cleanCurrentPrices = {};
    Object.keys(currentPrices).forEach(k => cleanCurrentPrices[k] = parseNum(currentPrices[k]));
    const cleanSoldCurrentPrices = {};
    Object.keys(soldCurrentPrices).forEach(k => cleanSoldCurrentPrices[k] = parseNum(soldCurrentPrices[k]));
    const finalUsdRate = parseNum(currentUsdRate);
    const historyEntry = { date: timestamp, timestampIso: now.toISOString(), prices: cleanCurrentPrices, soldPrices: cleanSoldCurrentPrices, usdRate: finalUsdRate, assetsSnapshot: cleanAssets };
    const updatedHistory = [...(event.priceHistory || []), historyEntry];
    try {
      await updateDoc(doc(db, "rotations", id), { eventName, boughtAssetsFromDb: cleanAssets, currentPricesFromDb: cleanCurrentPrices, soldCurrentPricesFromDb: cleanSoldCurrentPrices, currentUsdRateFromDb: finalUsdRate, isClosed: closeValue, lastUpdated: timestamp, priceHistory: updatedHistory });
      setIsEditingStructure(false);
      setAdvancedEditIndex(null);
      window.location.reload();
    } catch (e) {}
    finally { setSaving(false); }
  };

  if (loading || !event) return (
    <div className="flex justify-center items-center min-h-screen bg-[#080F12]">
      <div className="w-10 h-10 border-2 border-[#1e3040] border-t-teal-400 rounded-full animate-spin" />
    </div>
  );

  const totalARS_Init = (event.soldAssets || []).reduce((sum, a) => sum + (parseNum(a.quantity) * parseNum(a.priceAtTrade)), 0);
  const totalUSD_Init = totalARS_Init / parseNum(event.initialUsdRate || 1);
  const totalARS_Now = currentAssets.reduce((sum, a) => sum + (parseNum(a.quantity) * parseNum(currentPrices[a.ticker])), 0);
  const totalUSD_Now = totalARS_Now / (parseNum(currentUsdRate) || parseNum(event.initialUsdRate) || 1);
  const totalARS_Now_Prev = (event.soldAssets || []).reduce((sum, a) => sum + (parseNum(a.quantity) * parseNum(soldCurrentPrices[a.ticker])), 0);
  const totalUSD_Now_Prev = totalARS_Now_Prev / (parseNum(currentUsdRate) || parseNum(event.initialUsdRate) || 1);
  const resultARS = totalARS_Now - totalARS_Init;
  const resultUSD = totalUSD_Now - totalUSD_Init;

  const pUSD = totalUSD_Init > 0 ? ((totalUSD_Now / totalUSD_Init) - 1) * 100 : 0;
  const pARS = totalARS_Init > 0 ? ((totalARS_Now / totalARS_Init) - 1) * 100 : 0;
  const pALFA = totalUSD_Now_Prev > 0 ? ((totalUSD_Now / totalUSD_Now_Prev) - 1) * 100 : 0;

  const getBadgeClasses = (val) => {
    if (val > 0.1) return 'bg-teal-400/10 text-teal-300 border border-teal-400/30';
    if (val < -0.1) return 'bg-red-400/10 text-red-300 border border-red-400/30';
    return 'bg-[#1a2428] text-[#A8C8C8] border border-[#2a3a40]';
  };

  const historyReversed = [...(event.priceHistory || [])].reverse();

  return (
    <div className="px-4 pt-6 max-w-[500px] mx-auto pb-32 font-[Space_Grotesk,system-ui,sans-serif] bg-[#080F12] min-h-screen relative overflow-hidden">
      <div className="pointer-events-none absolute top-[-150px] right-[-200px] w-[600px] h-[500px] rounded-full bg-teal-400/[0.04] blur-[100px]" />

      {/* Back button */}
      <button
        onClick={() => navigate('/rotaciones')}
        className="flex items-center gap-2 text-teal-400 hover:text-teal-300 font-mono text-[12px] tracking-[0.15em] uppercase transition-colors bg-transparent border-none cursor-pointer mb-5 relative z-10"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 5l-7 7 7 7"/>
        </svg>
        Volver a Estrategias
      </button>

      {/* Event title */}
      <div className="mb-6 relative z-10">
        <input
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
          disabled={!isEditingStructure || event.isClosed}
          className="w-full bg-transparent border-none outline-none text-2xl font-bold text-[#F0FAFA] p-0 mb-2 tracking-tight disabled:opacity-100"
          style={{ WebkitAppearance: 'none' }}
        />
        <div className="flex justify-between items-center">
          <span className="font-mono text-[12px] text-[#5B8A8A] tracking-[0.1em]">Iniciada el {event.tradeDate}</span>
          <div className="flex items-center gap-2">
            {event.lastUpdated && (
              <span className="font-mono text-[11px] tracking-[0.12em] uppercase text-[#5B8A8A] bg-[#0C1518] border border-teal-400/10 px-2 py-1 rounded-lg">
                Act: {event.lastUpdated}hs
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Summary values */}
      <div className="bg-[#122329] border border-teal-400/15 rounded-2xl p-5 mb-4 relative z-10">
        <div className="grid grid-cols-2 gap-4">
          <div className="border-r border-teal-400/10 pr-4">
            <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A] mb-2">Invertido</div>
            <div className="text-xl font-black text-[#A8C8C8]">$ {totalARS_Init.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="font-mono text-[13px] text-[#5B8A8A] mt-0.5">US$ {totalUSD_Init.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div className="pl-1">
            <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-teal-400/70 mb-2">Valor Actual</div>
            <div className="text-xl font-black text-teal-400">$ {totalARS_Now.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="font-mono text-[13px] text-teal-400/60 mt-0.5">US$ {totalUSD_Now.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-teal-400/10 flex justify-between items-end gap-3">
          <div>
            <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A] mb-1">Ganancia / Pérdida</div>
            <div className={`text-lg font-black ${resultARS >= 0 ? 'text-teal-300' : 'text-red-300'}`}>
              {fmtSignedARS(resultARS)}
            </div>
          </div>
          <div className={`font-mono text-[13px] text-right ${resultUSD >= 0 ? 'text-teal-400/70' : 'text-red-400/80'}`}>
            {fmtSignedUSD(resultUSD)}
          </div>
        </div>
      </div>

      {/* Performance badges */}
      <div className="grid grid-cols-3 gap-2 mb-5 relative z-10">
        {[
          { label: 'REND. USD', val: pUSD },
          { label: 'REND. ARS', val: pARS },
          { label: 'ALFA', val: pALFA },
        ].map(({ label, val }) => (
          <div key={label} className={`text-center py-3 rounded-xl ${getBadgeClasses(val)}`}>
            <div className="font-mono text-[8px] tracking-[0.15em] uppercase mb-1 opacity-80">{label}</div>
            <div className="text-lg font-black">{val.toFixed(1)}%</div>
          </div>
        ))}
      </div>

      {/* Bought position */}
      <div className="bg-[#122329] border border-teal-400/15 rounded-2xl p-5 mb-4 relative z-10">
        <div className="flex justify-between items-center mb-5">
          <div className="flex items-center gap-3">
            <p className={KICKER}>
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2DD4BF]" />
              Posición Comprada
            </p>
            <div className="flex bg-[#0C1518] border border-teal-400/10 rounded-lg p-0.5">
              <button
                onClick={() => setViewCurrency('ARS')}
                className={`px-2.5 py-1 rounded-md font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${viewCurrency === 'ARS' ? 'bg-teal-400/10 text-teal-300 border border-teal-400/30' : 'text-[#5B8A8A]'}`}
              >ARS</button>
              <button
                onClick={() => setViewCurrency('USD')}
                className={`px-2.5 py-1 rounded-md font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${viewCurrency === 'USD' ? 'bg-teal-400/10 text-teal-300 border border-teal-400/30' : 'text-[#5B8A8A]'}`}
              >USD</button>
            </div>
          </div>
          {!event.isClosed && (
            <button
              onClick={toggleEditStructure}
              className={`font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 rounded-lg transition-colors border ${
                isEditingStructure
                  ? 'bg-[#0C1518] border-teal-400/30 text-[#A8C8C8]'
                  : 'bg-teal-400/10 border-teal-400/20 hover:border-teal-400/40 text-teal-400'
              }`}
            >
              {isEditingStructure ? 'Cerrar' : 'Editar'}
            </button>
          )}
        </div>

        {currentAssets.map((asset, index) => {
          const pCompraARS = parseNum(asset.priceAtTrade);
          const pActualARS = parseNum(currentPrices[asset.ticker]);
          const initUsd = parseNum(asset.usdRateAtTrade) || parseNum(event.initialUsdRate) || 1;
          const currUsd = parseNum(currentUsdRate) || 1;
          const pCompraUSD = pCompraARS / initUsd;
          const pActualUSD = pActualARS / currUsd;
          const qty = parseNum(asset.quantity);
          const investedARS = pCompraARS * qty;
          const currentARS = pActualARS * qty;
          const investedUSD = pCompraUSD * qty;
          const currentUSD = pActualUSD * qty;
          const varAmountARS = currentARS - investedARS;
          const varAmountUSD = currentUSD - investedUSD;
          const varPctARS = pCompraARS > 0 ? ((pActualARS / pCompraARS) - 1) * 100 : 0;
          const varPctUSD = pCompraUSD > 0 ? ((pActualUSD / pCompraUSD) - 1) * 100 : 0;
          const varPct = viewCurrency === 'USD' ? varPctUSD : varPctARS;
          const varAmount = viewCurrency === 'USD' ? varAmountUSD : varAmountARS;

          return (
            <div key={index} className="mb-4 pb-4 border-b border-teal-400/5">
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                  {isEditingStructure ? (
                    <input
                      type="text"
                      value={asset.ticker}
                      onChange={(e) => setCurrentAssets(currentAssets.map((a, i) => i === index ? { ...a, ticker: e.target.value.toUpperCase() } : a))}
                      placeholder="TICKER"
                      className="text-base font-black bg-[#0C1518] border border-teal-400/20 rounded-lg px-2 py-1 w-24 text-[#F0FAFA] outline-none font-mono"
                    />
                  ) : (
                    <div className="text-base font-black text-[#F0FAFA] font-mono">{asset.ticker}</div>
                  )}
                  {!isEditingStructure && pCompraARS > 0 && (
                    <div className={`font-mono text-[11px] uppercase tracking-[0.1em] px-2 py-0.5 rounded-lg ${varPct >= 0 ? 'bg-teal-400/10 text-teal-300' : 'bg-red-400/10 text-red-300'}`}>
                      {varPct >= 0 ? '▲' : '▼'} {Math.abs(varPct).toFixed(1)}% · {viewCurrency === 'USD' ? fmtSignedUSD(varAmount) : fmtSignedARS(varAmount)}
                    </div>
                  )}
                </div>
                {isEditingStructure && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAdvancedEditIndex(advancedEditIndex === index ? null : index)}
                      className="w-7 h-7 bg-[#0C1518] border border-teal-400/15 hover:border-teal-400/30 text-[#5B8A8A] rounded-lg transition-colors flex items-center justify-center"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => handleRemoveAsset(index)}
                      className="font-mono text-[11px] uppercase tracking-[0.1em] px-2 py-1 bg-red-400/10 border border-red-400/20 hover:border-red-400/40 text-red-400 rounded-lg transition-colors"
                    >X</button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={LABEL}>Cantidad</label>
                  {isEditingStructure ? (
                    <input type="text" value={formatInput(asset.quantity)} onChange={(e) => setCurrentAssets(currentAssets.map((a, i) => i === index ? { ...a, quantity: e.target.value } : a))} className={INPUT} />
                  ) : (
                    <div className={BOX_READ}>{fmtQty(asset.quantity)}</div>
                  )}
                </div>
                <div>
                  <label className={LABEL}>Compra</label>
                  {viewCurrency === 'USD' ? (
                    <div className={BOX_READ}>{fmtUSD(pCompraUSD)}</div>
                  ) : (
                    isEditingStructure ? (
                      <div className="relative">
                        <span className="absolute left-3 top-2.5 text-[#5B8A8A] text-sm font-mono">$</span>
                        <input type="text" value={formatInput(asset.priceAtTrade)} onBlur={(e) => setCurrentAssets(currentAssets.map((a, i) => i === index ? { ...a, priceAtTrade: formatDecimals(e.target.value) } : a))} onChange={(e) => setCurrentAssets(currentAssets.map((a, i) => i === index ? { ...a, priceAtTrade: e.target.value } : a))} className={`${INPUT} pl-7 text-right`} />
                      </div>
                    ) : (
                      <div className={BOX_READ}>{fmtARS(pCompraARS)}</div>
                    )
                  )}
                </div>
                <div>
                  <label className={LABEL}>Actual</label>
                  {viewCurrency === 'USD' ? (
                    <div className={BOX_READ_TEAL}>{fmtUSD(pActualUSD)}</div>
                  ) : (
                    event.isClosed ? (
                      <div className={BOX_READ_TEAL}>{fmtARS(pActualARS)}</div>
                    ) : (
                      <div className="relative">
                        <span className="absolute left-3 top-2.5 text-teal-400/70 text-sm font-mono">$</span>
                        <input type="text" value={formatInput(currentPrices[asset.ticker])} onBlur={(e) => setCurrentPrices({ ...currentPrices, [asset.ticker]: formatDecimals(e.target.value) })} onChange={(e) => setCurrentPrices({ ...currentPrices, [asset.ticker]: e.target.value })} className={`${INPUT_TEAL} pl-7`} />
                      </div>
                    )
                  )}
                </div>
              </div>

              {advancedEditIndex === index && (
                <div className="mt-3 p-3 bg-[#0C1518] border border-teal-400/10 rounded-xl">
                  <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A] mb-3">Ajustes de Origen</div>
                  <div>
                    <label className={LABEL}>Tipo de cambio al comprar</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-[#5B8A8A] text-sm font-mono">$</span>
                      <input type="text" value={formatInput(asset.usdRateAtTrade)} onBlur={(e) => setCurrentAssets(currentAssets.map((a, i) => i === index ? { ...a, usdRateAtTrade: formatDecimals(e.target.value) } : a))} onChange={(e) => setCurrentAssets(currentAssets.map((a, i) => i === index ? { ...a, usdRateAtTrade: e.target.value } : a))} className={`${INPUT} pl-7 text-right`} />
                    </div>
                  </div>
                </div>
              )}

              <div className="border-t border-teal-400/10 pt-3 mt-3 grid grid-cols-3 gap-2">
                <div>
                  <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-[#5B8A8A] mb-1">Invertido</div>
                  <div className="font-bold text-[#A8C8C8] text-sm">
                    {viewCurrency === 'USD' ? fmtUSD(investedUSD) : fmtARS(investedARS)}
                  </div>
                </div>
                <div className="text-center">
                  <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-[#5B8A8A] mb-1">Actual</div>
                  <div className="font-bold text-teal-400 text-sm">
                    {viewCurrency === 'USD' ? fmtUSD(currentUSD) : fmtARS(currentARS)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-[#5B8A8A] mb-1">Resultado</div>
                  <div className={`font-bold text-sm ${varAmount >= 0 ? 'text-teal-300' : 'text-red-300'}`}>
                    {viewCurrency === 'USD' ? fmtSignedUSD(varAmountUSD) : fmtSignedARS(varAmountARS)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {isEditingStructure && (
          <button
            onClick={handleAddAsset}
            className="w-full py-3 border-2 border-dashed border-teal-400/20 hover:border-teal-400/40 bg-transparent text-[#5B8A8A] hover:text-[#A8C8C8] font-mono text-[12px] tracking-[0.15em] uppercase rounded-xl transition-colors mt-2"
          >
            + Agregar Activo
          </button>
        )}
      </div>

      {/* Sold position (ALFA reference) */}
      <div className="bg-[#0C1518] border border-teal-400/10 rounded-2xl p-5 mb-4 relative z-10">
        <p className={`${KICKER} mb-4`}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#5B8A8A]" />
          Activos Vendidos (Referencia ALFA)
        </p>

        {(event.soldAssets || []).map((asset) => {
          const pActualARS = parseNum(soldCurrentPrices[asset.ticker]);
          const pActualUSD = pActualARS / (parseNum(currentUsdRate) || 1);

          return (
            <div key={asset.ticker} className="mb-4 pb-4 border-b border-teal-400/5">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-black text-[#A8C8C8] font-mono">{asset.ticker}</span>
                <span className="font-mono text-[11px] text-[#5B8A8A] bg-[#122329] border border-teal-400/10 px-2 py-1 rounded-lg">
                  Cant: {fmtQty(asset.quantity)}
                </span>
              </div>
              <div>
                <label className={LABEL}>Precio Actual</label>
                {viewCurrency === 'USD' ? (
                  <div className={BOX_READ_TEAL}>{fmtUSD(pActualUSD)}</div>
                ) : (
                  event.isClosed ? (
                    <div className={BOX_READ_TEAL}>{fmtARS(pActualARS)}</div>
                  ) : (
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-teal-400/70 text-sm font-mono">$</span>
                      <input type="text" value={formatInput(soldCurrentPrices[asset.ticker])} onBlur={(e) => setSoldCurrentPrices({ ...soldCurrentPrices, [asset.ticker]: formatDecimals(e.target.value) })} onChange={(e) => setSoldCurrentPrices({ ...soldCurrentPrices, [asset.ticker]: e.target.value })} className={`${INPUT_TEAL} pl-7`} />
                    </div>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* MEP rate */}
      {parseNum(currentUsdRate) > 0 && (
        <div className="flex justify-between items-center px-4 py-3 bg-[#122329] border border-teal-400/10 rounded-xl mb-5 relative z-10">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-teal-400 shadow-[0_0_6px_#2DD4BF]" />
            <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A]">Dólar MEP</span>
          </div>
          <span className="font-black text-[#F0FAFA]">$ {formatInput(currentUsdRate)}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="relative z-10 mb-6">
        {event.isClosed ? (
          <button
            onClick={() => save(false)}
            className="w-full py-4 bg-[#0C1518] border border-teal-400/20 hover:border-teal-400/40 text-[#A8C8C8] rounded-xl font-mono text-[13px] uppercase tracking-[0.18em] transition-colors"
          >
            Reabrir Operación
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <button
              onClick={() => save(false)}
              disabled={saving}
              className="w-full py-4 bg-teal-400 hover:bg-teal-300 text-[#080F12] rounded-xl font-bold font-mono text-[13px] uppercase tracking-[0.18em] shadow-[0_8px_24px_rgba(45,212,191,0.2)] transition-colors disabled:opacity-60"
            >
              {saving ? 'Guardando...' : 'Guardar y Registrar Precios'}
            </button>
            <button
              onClick={() => { if (window.confirm("¿Cerrar operación definitivamente?")) save(true); }}
              className="bg-transparent border-none text-red-400/70 hover:text-red-400 font-mono text-[12px] uppercase tracking-[0.15em] py-3 transition-colors cursor-pointer"
            >
              Cerrar Operación
            </button>
          </div>
        )}
      </div>

      {/* Price history */}
      {historyReversed.length > 0 && (
        <div className="relative z-10 mt-4">
          <p className={`${KICKER} mb-4`}>
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2DD4BF]" />
            Historial de Precios
          </p>
          <div className="flex flex-col gap-3">
            {historyReversed.map((entry, idx) => {
              const historicAssets = entry.assetsSnapshot || currentAssets;
              const hTotalARS_Now = historicAssets.reduce((sum, a) => sum + (parseNum(a.quantity) * parseNum(entry.prices[a.ticker])), 0);
              const hTotalUSD_Now = hTotalARS_Now / parseNum(entry.usdRate || 1);
              const hTotalARS_Now_Prev = (event.soldAssets || []).reduce((sum, a) => sum + (parseNum(a.quantity) * parseNum(entry.soldPrices[a.ticker])), 0);
              const hTotalUSD_Now_Prev = hTotalARS_Now_Prev / parseNum(entry.usdRate || 1);
              const hAlfa = hTotalUSD_Now_Prev > 0 ? ((hTotalUSD_Now / hTotalUSD_Now_Prev) - 1) * 100 : 0;

              return (
                <div key={idx} className="bg-[#122329] border border-teal-400/10 rounded-xl p-4">
                  <div className="flex justify-between items-center mb-3">
                    <div>
                      <div className="font-bold text-[#F0FAFA] text-sm">{entry.date}</div>
                      <div className="font-mono text-[12px] text-[#5B8A8A] mt-0.5">Dólar: {fmtARS(entry.usdRate)}</div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold text-sm ${hAlfa >= 0 ? 'text-teal-400' : 'text-red-400'}`}>
                        ALFA: {hAlfa > 0 ? '+' : ''}{hAlfa.toFixed(1)}%
                      </div>
                      <div className="font-mono text-[12px] text-[#5B8A8A] mt-0.5">{fmtUSD(hTotalUSD_Now)}</div>
                    </div>
                  </div>

                  <div className="border-t border-teal-400/5 pt-3">
                    <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A] mb-2">Posición Comprada</div>
                    {historicAssets.map(a => (
                      <div key={a.ticker} className="flex justify-between text-sm mb-1">
                        <span className="font-bold text-[#A8C8C8] font-mono">
                          {a.ticker} <span className="font-normal text-[#5B8A8A]">(x{fmtQty(a.quantity)})</span>
                        </span>
                        <span className="font-bold text-teal-400 font-mono">
                          {viewCurrency === 'USD' ? fmtUSD(parseNum(entry.prices[a.ticker]) / parseNum(entry.usdRate || 1)) : fmtARS(entry.prices[a.ticker])}
                        </span>
                      </div>
                    ))}

                    <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A] mt-3 mb-2">Posición Vendida (REF)</div>
                    {(event.soldAssets || []).map(a => (
                      <div key={a.ticker} className="flex justify-between text-sm mb-1">
                        <span className="font-bold text-[#5B8A8A] font-mono">
                          {a.ticker} <span className="font-normal">(x{fmtQty(a.quantity)})</span>
                        </span>
                        <span className="font-bold text-[#5B8A8A] font-mono">
                          {viewCurrency === 'USD' ? fmtUSD(parseNum(entry.soldPrices[a.ticker]) / parseNum(entry.usdRate || 1)) : fmtARS(entry.soldPrices[a.ticker])}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
