import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { fetchAllPrices, isBondTicker, getMepRate, getCclRate, getBrokerLivePrice } from '../utils/priceService';
import { esMercadoAbierto } from '../utils/marketHours';
import { getBrokerName, isUsdBroker } from '../utils/brokers';
import { formatDecimals, formatInput, formatPrice, normalizeTypedInput, parseNum } from '../utils/numberFormat';

const KICKER = "font-mono text-[12px] tracking-[0.22em] uppercase text-teal-400 flex items-center gap-1.5";
const INPUT = "w-full px-3 py-2.5 bg-[#0C1518] border border-teal-400/15 hover:border-teal-400/30 focus:border-teal-400/60 text-[#F0FAFA] placeholder-[#3d5a5a] rounded-xl text-sm outline-none transition-colors box-border";
const LABEL = "block font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A] mb-1.5";

export default function BrokerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [usdRate, setUsdRate] = useState('');
  const [debt, setDebt] = useState('');

  const isUSD = isUsdBroker(id);

  const fmtQty = (v) => parseNum(v).toLocaleString('es-AR');
  const fmtARS = (v) => '$ ' + parseNum(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtUSD = (v) => 'USD ' + parseNum(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  useEffect(() => {
    const fetchData = async (livePrices = {}, liveMepRate = null) => {
      try {
        const docSnap = await getDoc(doc(db, "brokerPositions", id));
        if (docSnap.exists()) {
          const data = docSnap.data();
          const formattedAssets = (data.assets || []).map(a => ({
            ticker: a.ticker,
            quantity: a.quantity?.toString().replace('.', ',') || '',
            price: formatPrice((() => {
              const ticker = a.ticker?.toUpperCase().trim();
              const livePrice = getBrokerLivePrice(ticker, livePrices, { isUSD, mepRate: liveMepRate });
              return livePrice ?? a.price;
            })()),
            isBond: a.isBond || isBondTicker(a.ticker) || false
          }));
          setAssets(formattedAssets);
          if (!isUSD) setUsdRate(formatDecimals(liveMepRate || data.usdRate || 0));
          if (data.debt) setDebt(formatDecimals(data.debt));
        }
      } catch (e) {}
      finally { setLoading(false); }
    };
    const init = async () => {
      let livePrices = {};
      if (esMercadoAbierto()) {
        try { livePrices = await fetchAllPrices(); } catch (e) {}
      }
      fetchData(livePrices, getMepRate());
    };
    init();
  }, [id, isUSD]);

  const handleAddAsset = () => setAssets([...assets, { ticker: '', quantity: '', price: '', isBond: false }]);
  const handleRemove = (index) => setAssets(assets.filter((_, i) => i !== index));

  const save = async () => {
    setSaving(true);
    try {
      const cleanAssets = assets.map(a => ({
        ticker: a.ticker,
        quantity: parseNum(a.quantity),
        price: parseNum(a.price),
        isBond: isBondTicker(a.ticker) || a.isBond || false
      }));
      await setDoc(doc(db, "brokerPositions", id), {
        assets: cleanAssets,
        usdRate: isUSD ? 1 : parseNum(usdRate),
        debt: parseNum(debt),
        lastUpdated: new Date().toISOString()
      });
      setIsEditing(false);
    } catch (e) {}
    finally { setSaving(false); }
  };

  const rate = isUSD ? 1 : (parseNum(usdRate) || 1);
  const totalAssetsUSD = assets.reduce((sum, asset) => {
    const isBond = asset.isBond || isBondTicker(asset.ticker);
    const divisor = isBond ? 100 : 1;
    return sum + ((parseNum(asset.quantity) * parseNum(asset.price)) / divisor / rate);
  }, 0);
  const totalUSD = totalAssetsUSD - parseNum(debt);

  const mepRate = getMepRate();
  const cclRate = getCclRate();
  const totalUSD_CCL = isUSD && mepRate > 0 && cclRate > 0
    ? totalUSD * mepRate / cclRate
    : null;

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen bg-[#080F12]">
      <div className="w-10 h-10 border-2 border-[#1e3040] border-t-teal-400 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="px-4 pt-6 max-w-[600px] mx-auto pb-32 font-[Space_Grotesk,system-ui,sans-serif] bg-[#080F12] min-h-screen relative overflow-hidden">
      <div className="pointer-events-none absolute top-[-150px] right-[-200px] w-[600px] h-[500px] rounded-full bg-teal-400/[0.04] blur-[100px]" />

      {/* Top nav */}
      <div className="flex justify-between items-center mb-6 relative z-10">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-teal-400 hover:text-teal-300 font-mono text-[12px] tracking-[0.15em] uppercase transition-colors bg-transparent border-none cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
          Volver
        </button>
        <button
          onClick={() => setIsEditing(!isEditing)}
          className={`font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 rounded-lg transition-colors border ${
            isEditing
              ? 'bg-[#0C1518] border-teal-400/30 text-[#A8C8C8]'
              : 'bg-teal-400/10 border-teal-400/20 hover:border-teal-400/50 text-teal-400'
          }`}
        >
          {isEditing ? 'Cancelar' : 'Editar Posición'}
        </button>
      </div>

      {/* Balance card */}
      <div className="bg-[#122329] border border-teal-400/20 rounded-2xl p-5 mb-5 shadow-[0_20px_40px_rgba(0,0,0,0.3)] relative z-10">
        <p className={KICKER}>
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2DD4BF]" />
          {getBrokerName(id)}
        </p>
        <div className="text-4xl font-black tracking-tight text-teal-400 mt-2">
          US$ {totalUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </div>
        {totalUSD_CCL !== null && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-teal-400/10">
            <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A]">Dólar Cable</span>
            <span className="font-bold text-[#A8C8C8]">
              US$ {totalUSD_CCL.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </span>
          </div>
        )}
      </div>

      {/* Assets list */}
      <div className="flex flex-col gap-3 relative z-10">
        {!isEditing ? (
          assets.map((asset, index) => {
            const assetValueUSD = (parseNum(asset.quantity) * parseNum(asset.price)) / ((asset.isBond || isBondTicker(asset.ticker)) ? 100 : 1) / rate;
            const pct = totalAssetsUSD > 0 ? (assetValueUSD / totalAssetsUSD) * 100 : 0;
            return (
              <div key={index} className="bg-[#122329] border border-teal-400/10 hover:border-teal-400/20 rounded-xl p-4 flex justify-between items-center transition-colors">
                <div>
                  <div className="text-base font-black text-[#F0FAFA] font-mono">{asset.ticker}</div>
                  <div className="font-mono text-[12px] text-[#5B8A8A] mt-1">
                    {fmtQty(asset.quantity)} nom. · {isUSD ? fmtUSD(asset.price) : fmtARS(asset.price)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-teal-400">{fmtUSD(assetValueUSD)}</div>
                  <div className="font-mono text-[12px] text-[#5B8A8A] mt-0.5">{pct.toFixed(1)}%</div>
                </div>
              </div>
            );
          })
        ) : (
          assets.map((asset, index) => (
            <div key={index} className="bg-[#122329] border border-teal-400/30 rounded-xl p-4">
              <div className="flex justify-between items-center mb-4">
                <input
                  placeholder="TICKER"
                  value={asset.ticker}
                  onChange={(e) => {
                    const newAssets = [...assets];
                    newAssets[index].ticker = e.target.value.toUpperCase();
                    setAssets(newAssets);
                  }}
                  className="font-black bg-transparent border-none outline-none text-lg text-[#F0FAFA] w-28 font-mono placeholder-[#3d5a5a]"
                />
                <button
                  onClick={() => handleRemove(index)}
                  className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 bg-red-400/10 border border-red-400/20 hover:border-red-400/50 text-red-400 rounded-lg transition-colors"
                >
                  Borrar
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={LABEL}>Cantidad</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formatInput(asset.quantity)}
                    onChange={(e) => {
                      const newAssets = [...assets];
                      newAssets[index].quantity = normalizeTypedInput(asset.quantity, e.target.value);
                      setAssets(newAssets);
                    }}
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL}>{isUSD ? 'Precio (USD)' : 'Precio (ARS)'}</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-[#5B8A8A] font-mono text-sm">{isUSD ? 'U$' : '$'}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatInput(asset.price)}
                      onBlur={(e) => {
                        const newAssets = [...assets];
                        newAssets[index].price = formatPrice(e.target.value);
                        setAssets(newAssets);
                      }}
                      onChange={(e) => {
                        const newAssets = [...assets];
                        newAssets[index].price = normalizeTypedInput(asset.price, e.target.value);
                        setAssets(newAssets);
                      }}
                      className={`${INPUT} pl-8`}
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-teal-400/10 pt-3 flex justify-between items-center">
                <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A]">Subtotal</span>
                <span className="font-bold text-teal-400">
                  {fmtUSD((parseNum(asset.quantity) * parseNum(asset.price)) / ((asset.isBond || isBondTicker(asset.ticker)) ? 100 : 1) / rate)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {isEditing && (
        <button
          onClick={handleAddAsset}
          className="w-full py-4 mt-4 border-2 border-dashed border-teal-400/20 hover:border-teal-400/40 bg-transparent text-[#5B8A8A] hover:text-[#A8C8C8] font-mono text-[12px] tracking-[0.15em] uppercase rounded-xl transition-colors"
        >
          + Nueva Especie
        </button>
      )}

      {/* Debt card */}
      <div className="bg-[#122329] border border-teal-400/10 rounded-xl p-4 flex justify-between items-center mt-4 relative z-10">
        <div>
          <div className="font-bold text-[#F0FAFA]">Caución / Deuda</div>
          <div className="font-mono text-[12px] text-[#5B8A8A] mt-0.5">Obligaciones en USD</div>
        </div>
        <div className="text-right">
          {!isEditing ? (
            <div className={`font-bold ${parseNum(debt) > 0 ? 'text-red-400' : 'text-[#F0FAFA]'}`}>
              {parseNum(debt) > 0 ? '-' : ''}{fmtUSD(debt)}
            </div>
          ) : (
            <div className="relative w-36">
              <span className="absolute left-3 top-2.5 text-red-400 font-mono text-sm">U$</span>
              <input
                type="text"
                inputMode="decimal"
                value={formatInput(debt)}
                onBlur={(e) => setDebt(formatDecimals(e.target.value))}
                onChange={(e) => setDebt(normalizeTypedInput(debt, e.target.value))}
                className="w-full pl-8 pr-3 py-2.5 bg-red-400/5 border border-red-400/20 hover:border-red-400/40 focus:border-red-400/60 text-red-400 rounded-xl text-sm outline-none transition-colors text-right box-border"
              />
            </div>
          )}
        </div>
      </div>

      {!isUSD && parseNum(usdRate) > 0 && (
        <div className="flex justify-between items-center px-4 py-3 bg-[#122329] border border-teal-400/10 rounded-xl mt-3 relative z-10">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-teal-400 shadow-[0_0_6px_#2DD4BF]" />
            <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A]">Dólar MEP</span>
          </div>
          <span className="font-black text-[#F0FAFA]">$ {formatInput(usdRate)}</span>
        </div>
      )}

      {isEditing && (
        <button
          onClick={save}
          disabled={saving}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-30px)] max-w-[570px] py-4 bg-teal-400 hover:bg-teal-300 text-[#080F12] rounded-xl font-bold font-mono text-[13px] uppercase tracking-[0.18em] shadow-[0_8px_24px_rgba(45,212,191,0.3)] z-[1000] transition-colors disabled:opacity-60"
        >
          {saving ? 'Guardando...' : 'Confirmar Cambios'}
        </button>
      )}
    </div>
  );
}
