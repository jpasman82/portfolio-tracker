import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

export default function EventDetail() {
  const { id } = useParams(); 
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditingStructure, setIsEditingStructure] = useState(false);
  const [currentAssets, setCurrentAssets] = useState([]); 
  const [currentPrices, setCurrentPrices] = useState({}); 
  const [soldCurrentPrices, setSoldCurrentPrices] = useState({}); 
  const [currentUsdRate, setCurrentUsdRate] = useState('');
  const [eventName, setEventName] = useState('');
  const [saving, setSaving] = useState(false);
  const [viewCurrency, setViewCurrency] = useState('ARS');

  const formatInput = (val) => {
    if (val === undefined || val === null || val === '') return '';
    let str = val.toString().replace(/\./g, ',');
    let clean = str.replace(/[^0-9,]/g, '');
    let parts = clean.split(',');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    if (parts.length > 2) parts = [parts[0], parts.slice(1).join('')];
    return parts.join(',');
  };

  const parseNum = (val) => {
    if (!val) return 0;
    return Number(val.toString().replace(/\./g, '').replace(',', '.')) || 0;
  };

  const formatDecimals = (val) => {
    return parseNum(val).toFixed(2).replace('.', ',');
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const docSnap = await getDoc(doc(db, "rotations", id));
        if (docSnap.exists()) {
          const data = docSnap.data();
          setEvent(data);
          setEventName(data.eventName);
          
          const initUsd = data.currentUsdRateFromDb || data.initialUsdRate || 1;
          setCurrentUsdRate(formatDecimals(initUsd));
          
          const assets = data.boughtAssetsFromDb || data.boughtAssets || [];
          const formattedAssets = assets.map(a => ({
            ...a,
            quantity: a.quantity?.toString().replace('.', ',') || '',
            priceAtTrade: formatDecimals(a.priceAtTrade),
            usdRateAtTrade: formatDecimals(a.usdRateAtTrade || initUsd)
          }));
          setCurrentAssets(formattedAssets);
          
          const pB = {};
          formattedAssets.forEach(a => pB[a.ticker] = formatDecimals(data.currentPricesFromDb?.[a.ticker] || a.priceAtTrade || 0));
          setCurrentPrices(pB);
          
          const pS = {};
          (data.soldAssets || []).forEach(a => pS[a.ticker] = formatDecimals(data.soldCurrentPricesFromDb?.[a.ticker] || a.priceAtTrade || 0));
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

  const handleRemoveAsset = (index) => {
    setCurrentAssets(currentAssets.filter((_, i) => i !== index));
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

    const historyEntry = {
      date: timestamp,
      timestampIso: now.toISOString(),
      prices: cleanCurrentPrices,
      soldPrices: cleanSoldCurrentPrices,
      usdRate: finalUsdRate,
      assetsSnapshot: cleanAssets
    };

    const updatedHistory = [...(event.priceHistory || []), historyEntry];

    try {
      await updateDoc(doc(db, "rotations", id), { 
        eventName, 
        boughtAssetsFromDb: cleanAssets, 
        currentPricesFromDb: cleanCurrentPrices, 
        soldCurrentPricesFromDb: cleanSoldCurrentPrices, 
        currentUsdRateFromDb: finalUsdRate, 
        isClosed: closeValue,
        lastUpdated: timestamp,
        priceHistory: updatedHistory
      });
      setIsEditingStructure(false); 
      window.location.reload();
    } catch (e) {}
    finally { setSaving(false); }
  };

  if (loading || !event) return <div style={{ padding: '100px', textAlign: 'center', fontWeight: 800, color: '#adb5bd' }}>Cargando...</div>;

  const totalARS_Init = (event.soldAssets || []).reduce((sum, a) => sum + (parseNum(a.quantity) * parseNum(a.priceAtTrade)), 0);
  const totalUSD_Init = totalARS_Init / parseNum(event.initialUsdRate || 1);
  const totalARS_Now = currentAssets.reduce((sum, a) => sum + (parseNum(a.quantity) * parseNum(currentPrices[a.ticker])), 0);
  const totalUSD_Now = totalARS_Now / (parseNum(currentUsdRate) || parseNum(event.initialUsdRate) || 1);
  const totalARS_Now_Prev = (event.soldAssets || []).reduce((sum, a) => sum + (parseNum(a.quantity) * parseNum(soldCurrentPrices[a.ticker])), 0);
  const totalUSD_Now_Prev = totalARS_Now_Prev / (parseNum(currentUsdRate) || parseNum(event.initialUsdRate) || 1);

  const pUSD = totalUSD_Init > 0 ? ((totalUSD_Now / totalUSD_Init) - 1) * 100 : 0;
  const pARS = totalARS_Init > 0 ? ((totalARS_Now / totalARS_Init) - 1) * 100 : 0;
  const pALFA = totalUSD_Now_Prev > 0 ? ((totalUSD_Now / totalUSD_Now_Prev) - 1) * 100 : 0;

  const badgeStyle = (val) => ({
    borderRadius: '16px', padding: '12px 5px', textAlign: 'center', 
    backgroundColor: val > 0.1 ? '#00c805' : val < -0.1 ? '#ff3b30' : '#f8f9fa', 
    color: Math.abs(val) > 0.1 ? 'white' : '#1a1d21'
  });

  const historyReversed = [...(event.priceHistory || [])].reverse();

  const fmtQty = (v) => formatInput(v);
  const fmtARS = (v) => '$ ' + formatInput(typeof v === 'number' ? v.toFixed(2) : v);
  const fmtUSD = (v) => 'USD ' + formatInput(typeof v === 'number' ? v.toFixed(2) : v);

  const boxRead = { width: '100%', padding: '0 12px', border: 'none', backgroundColor: '#f8f9fa', borderRadius: 12, fontWeight: 700, boxSizing: 'border-box', fontSize: '14px', color: '#1a1d21', display: 'flex', alignItems: 'center', height: '42px', overflow: 'hidden', justifyContent: 'flex-end' };
  const boxReadBlue = { ...boxRead, backgroundColor: 'rgba(13,110,253,0.03)', border: '1px solid rgba(13,110,253,0.2)', color: '#0d6efd' };
  const inpWrite = { width: '100%', padding: '10px 12px', border: '1px solid #dee2e6', backgroundColor: '#fff', borderRadius: 12, fontWeight: 700, outline: 'none', boxSizing: 'border-box', fontSize: '14px', color: '#1a1d21', height: '42px', textAlign: 'right' };
  const inpWriteBlue = { ...inpWrite, border: '1px solid #0d6efd', color: '#0d6efd', backgroundColor: 'rgba(13,110,253,0.02)' };

  return (
    <div style={{ padding: '24px 15px', maxWidth: '500px', margin: 'auto', paddingBottom: '120px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <button onClick={() => navigate('/rotaciones')} style={{ background: 'none', border: 'none', color: '#0d6efd', fontWeight: 800, marginBottom: 15, fontSize: '14px', padding: 0 }}>← Volver a Estrategias</button>
      
      <div style={{ marginBottom: 25 }}>
        <input 
          value={eventName} 
          onChange={(e) => setEventName(e.target.value)} 
          disabled={!isEditingStructure || event.isClosed} 
          style={{ width: '100%', border: 'none', background: 'transparent', fontSize: '24px', fontWeight: 900, outline: 'none', marginBottom: 5, color: '#1a1d21', padding: 0 }} 
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
           <span style={{ fontSize: '12px', color: '#adb5bd', fontWeight: 700 }}>Iniciada el {event.tradeDate}</span>
           {event.lastUpdated && <span style={{ fontSize: '10px', color: '#1a1d21', fontWeight: 800, backgroundColor: '#e9ecef', padding: '4px 8px', borderRadius: '6px' }}>Act: {event.lastUpdated}hs</span>}
        </div>
      </div>
      
      <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '24px', border: '1px solid #eee', marginBottom: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
          <div style={{ borderRight: '1px solid #f0f0f0', paddingRight: '10px' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, color: '#adb5bd', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Invertido</div>
            <div style={{ fontSize: '20px', fontWeight: 900, marginTop: '4px' }}>$ {totalARS_Init.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
            <div style={{ fontSize: '13px', color: '#adb5bd', fontWeight: 700 }}>US$ {totalUSD_Init.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
          </div>
          <div style={{ paddingLeft: '5px' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, color: '#198754', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Valor Actual</div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: '#198754', marginTop: '4px' }}>$ {totalARS_Now.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
            <div style={{ fontSize: '13px', color: '#198754', fontWeight: 700 }}>US$ {totalUSD_Now.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '24px' }}>
        <div style={badgeStyle(pUSD)}><div style={{ fontSize: '9px', fontWeight: 800, opacity: 0.9 }}>REND. USD</div><div style={{ fontSize: '18px', fontWeight: 900, marginTop: '2px' }}>{pUSD.toFixed(1)}%</div></div>
        <div style={badgeStyle(pARS)}><div style={{ fontSize: '9px', fontWeight: 800, opacity: 0.9 }}>REND. ARS</div><div style={{ fontSize: '18px', fontWeight: 900, marginTop: '2px' }}>{pARS.toFixed(1)}%</div></div>
        <div style={badgeStyle(pALFA)}><div style={{ fontSize: '9px', fontWeight: 800, opacity: 0.9 }}>ALFA</div><div style={{ fontSize: '18px', fontWeight: 900, marginTop: '2px' }}>{pALFA.toFixed(1)}%</div></div>
      </div>

      <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '24px', border: '1px solid #eaecef', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#1a1d21' }}>Posición Comprada</h4>
            <div style={{ display: 'flex', background: '#eaecef', borderRadius: '8px', padding: '3px' }}>
              <button onClick={() => setViewCurrency('ARS')} style={{ border: 'none', background: viewCurrency === 'ARS' ? '#1a1d21' : 'transparent', color: viewCurrency === 'ARS' ? 'white' : '#6c757d', padding: '4px 10px', borderRadius: '6px', fontSize: '10px', fontWeight: 800 }}>ARS</button>
              <button onClick={() => setViewCurrency('USD')} style={{ border: 'none', background: viewCurrency === 'USD' ? '#1a1d21' : 'transparent', color: viewCurrency === 'USD' ? 'white' : '#6c757d', padding: '4px 10px', borderRadius: '6px', fontSize: '10px', fontWeight: 800 }}>USD</button>
            </div>
          </div>
          {!event.isClosed && (
            <button onClick={() => setIsEditingStructure(!isEditingStructure)} style={{ border: 'none', background: isEditingStructure ? '#1a1d21' : '#f8f9fa', color: isEditingStructure ? 'white' : '#1a1d21', fontWeight: 800, fontSize: '11px', padding: '6px 12px', borderRadius: 10 }}>
              {isEditingStructure ? 'Dejar de editar' : 'Editar'}
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

          const varPct = viewCurrency === 'USD' 
            ? (pCompraUSD > 0 ? ((pActualUSD / pCompraUSD) - 1) * 100 : 0)
            : (pCompraARS > 0 ? ((pActualARS / pCompraARS) - 1) * 100 : 0);

          return (
            <div key={index} style={{ marginBottom: '16px', borderBottom: '1px solid #f8f9fa', paddingBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {isEditingStructure ? (
                    <input type="text" value={asset.ticker} onChange={(e) => setCurrentAssets(currentAssets.map((a, i) => i === index ? {...a, ticker: e.target.value.toUpperCase()} : a))} placeholder="TICKER" style={{ fontSize: '16px', fontWeight: 900, border: '1px solid #eee', borderRadius: 8, padding: '4px 8px', width: '100px', outline: 'none' }} />
                  ) : (
                    <div style={{ fontSize: '18px', fontWeight: 900, color: '#1a1d21' }}>{asset.ticker}</div>
                  )}
                  
                  {!isEditingStructure && pCompraARS > 0 && (
                    <div style={{ fontSize: '11px', fontWeight: 800, color: varPct >= 0 ? '#198754' : '#dc3545', backgroundColor: varPct >= 0 ? '#eaffeb' : '#fff0f0', padding: '4px 8px', borderRadius: 8 }}>
                      {varPct >= 0 ? '▲' : '▼'} {Math.abs(varPct).toFixed(1)}%
                    </div>
                  )}
                </div>
                {isEditingStructure && (
                  <button onClick={() => handleRemoveAsset(index)} style={{ color: '#ff3b30', border: 'none', background: '#fff0f0', padding: '4px 8px', borderRadius: 6, fontSize: '10px', fontWeight: 800 }}>X</button>
                )}
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '9px', fontWeight: 800, color: '#adb5bd', display: 'block', marginBottom: '4px' }}>CANTIDAD</label>
                  {isEditingStructure ? (
                    <input type="text" value={formatInput(asset.quantity)} onChange={(e) => setCurrentAssets(currentAssets.map((a, i) => i === index ? {...a, quantity: e.target.value} : a))} style={inpWrite} />
                  ) : (
                    <div style={boxRead}>{fmtQty(asset.quantity)}</div>
                  )}
                </div>
                <div>
                  <label style={{ fontSize: '9px', fontWeight: 800, color: '#adb5bd', display: 'block', marginBottom: '4px' }}>COMPRA</label>
                  {viewCurrency === 'USD' ? (
                    <div style={boxRead}>{fmtUSD(pCompraUSD)}</div>
                  ) : (
                    isEditingStructure ? (
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '10px', top: '11px', color: '#1a1d21', fontWeight: 800, fontSize: '14px' }}>$</span>
                        <input type="text" value={formatInput(asset.priceAtTrade)} onBlur={(e) => setCurrentAssets(currentAssets.map((a, i) => i === index ? {...a, priceAtTrade: formatDecimals(e.target.value)} : a))} onChange={(e) => setCurrentAssets(currentAssets.map((a, i) => i === index ? {...a, priceAtTrade: e.target.value} : a))} style={{...inpWrite, paddingLeft: '22px'}} />
                      </div>
                    ) : (
                      <div style={boxRead}>{fmtARS(pCompraARS)}</div>
                    )
                  )}
                </div>
                <div>
                  <label style={{ fontSize: '9px', fontWeight: 800, color: '#adb5bd', display: 'block', marginBottom: '4px' }}>ACTUAL</label>
                  {viewCurrency === 'USD' ? (
                    <div style={boxReadBlue}>{fmtUSD(pActualUSD)}</div>
                  ) : (
                    event.isClosed ? (
                      <div style={boxReadBlue}>{fmtARS(pActualARS)}</div>
                    ) : (
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '10px', top: '11px', color: '#0d6efd', fontWeight: 800, fontSize: '14px' }}>$</span>
                        <input type="text" value={formatInput(currentPrices[asset.ticker])} onBlur={(e) => setCurrentPrices({...currentPrices, [asset.ticker]: formatDecimals(e.target.value)})} onChange={(e) => setCurrentPrices({...currentPrices, [asset.ticker]: e.target.value})} style={{...inpWriteBlue, paddingLeft: '22px'}} />
                      </div>
                    )
                  )}
                </div>
              </div>
              
              <div style={{ borderTop: '1px solid #eaecef', paddingTop: '12px', marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: '#adb5bd' }}>SUBTOTAL</span>
                <span style={{ fontSize: '16px', fontWeight: 900, color: '#198754' }}>
                  {viewCurrency === 'USD' ? fmtUSD(pActualUSD * parseNum(asset.quantity)) : fmtARS(pActualARS * parseNum(asset.quantity))}
                </span>
              </div>
            </div>
          );
        })}
        {isEditingStructure && (
          <button onClick={handleAddAsset} style={{ width: '100%', padding: '12px', borderRadius: 12, border: '2px dashed #dee2e6', background: 'transparent', fontWeight: 800, color: '#adb5bd', fontSize: '12px', marginTop: '10px' }}>
            + Agregar Activo
          </button>
        )}
      </div>

      <div style={{ backgroundColor: '#f8f9fa', padding: '24px', borderRadius: '24px', border: '1px solid #eaecef', marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 20px 0', fontSize: '14px', fontWeight: 800, color: '#6c757d' }}>Activos Vendidos (Para ALFA)</h4>
        {(event.soldAssets || []).map((asset) => {
          const pActualARS = parseNum(soldCurrentPrices[asset.ticker]);
          const pActualUSD = pActualARS / (parseNum(currentUsdRate) || 1);

          return (
            <div key={asset.ticker} style={{ marginBottom: '16px', borderBottom: '1px solid #eaecef', paddingBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '16px', fontWeight: 900, color: '#495057' }}>{asset.ticker}</span>
                <span style={{fontSize: '12px', fontWeight: 700, color: '#adb5bd', backgroundColor: 'white', padding: '4px 8px', borderRadius: 8, border: '1px solid #eaecef'}}>Cant: {fmtQty(asset.quantity)}</span>
              </div>
              <div>
                <label style={{ fontSize: '10px', fontWeight: 800, color: '#adb5bd', display: 'block', marginBottom: '4px' }}>PRECIO ACTUAL</label>
                {viewCurrency === 'USD' ? (
                  <div style={boxReadBlue}>{fmtUSD(pActualUSD)}</div>
                ) : (
                  event.isClosed ? (
                    <div style={boxReadBlue}>{fmtARS(pActualARS)}</div>
                  ) : (
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: '12px', top: '11px', color: '#0d6efd', fontWeight: 800, fontSize: '14px' }}>$</span>
                      <input type="text" value={formatInput(soldCurrentPrices[asset.ticker])} onBlur={(e) => setSoldCurrentPrices({...soldCurrentPrices, [asset.ticker]: formatDecimals(e.target.value)})} onChange={(e) => setSoldCurrentPrices({...soldCurrentPrices, [asset.ticker]: e.target.value})} style={{...inpWriteBlue, paddingLeft: '24px'}} />
                    </div>
                  )
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ backgroundColor: 'white', padding: '20px 24px', borderRadius: '24px', border: '1px solid #eaecef', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label style={{ fontSize: '13px', fontWeight: 800, color: '#1a1d21' }}>Dólar MEP</label>
        <div style={{ position: 'relative', width: '120px' }}>
          <span style={{ position: 'absolute', left: '0', top: '2px', color: '#1a1d21', fontWeight: 900, fontSize: '18px' }}>$</span>
          <input type="text" value={formatInput(currentUsdRate)} onBlur={(e) => setCurrentUsdRate(formatDecimals(e.target.value))} disabled={event.isClosed} onChange={(e) => setCurrentUsdRate(e.target.value)} style={{ width: '100%', border: 'none', fontSize: '20px', fontWeight: 900, outline: 'none', textAlign: 'right', color: '#1a1d21', backgroundColor: 'transparent', paddingLeft: '15px', boxSizing: 'border-box' }} />
        </div>
      </div>

      {event.isClosed ? (
        <button onClick={() => save(false)} style={{ width: '100%', padding: '20px', backgroundColor: 'transparent', color: '#1a1d21', border: '2px solid #1a1d21', borderRadius: '20px', fontWeight: 800, fontSize: '15px' }}>Reabrir Operación</button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button onClick={() => save(false)} disabled={saving} style={{ width: '100%', padding: '20px', backgroundColor: '#0d6efd', color: 'white', border: 'none', borderRadius: '20px', fontWeight: 800, fontSize: '16px', boxShadow: '0 8px 20px rgba(13,110,253,0.2)' }}>{saving ? 'Guardando...' : 'Guardar y Registrar Precios'}</button>
          <button onClick={() => { if(window.confirm("¿Cerrar operación definitivamente?")) save(true) }} style={{ color: '#dc3545', border: 'none', background: 'none', fontSize: '13px', fontWeight: 700, padding: '10px' }}>Cerrar Operación</button>
        </div>
      )}

      {historyReversed.length > 0 && (
        <div style={{ marginTop: '40px' }}>
          <h4 style={{ fontSize: '16px', fontWeight: 900, color: '#1a1d21', marginBottom: '15px' }}>Historial de Precios</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {historyReversed.map((entry, idx) => {
              const historicAssets = entry.assetsSnapshot || currentAssets;
              const hTotalARS_Init = (event.soldAssets || []).reduce((sum, a) => sum + (parseNum(a.quantity) * parseNum(a.priceAtTrade)), 0);
              const hTotalARS_Now = historicAssets.reduce((sum, a) => sum + (parseNum(a.quantity) * parseNum(entry.prices[a.ticker])), 0);
              const hTotalUSD_Now = hTotalARS_Now / parseNum(entry.usdRate || 1);
              const hTotalARS_Now_Prev = (event.soldAssets || []).reduce((sum, a) => sum + (parseNum(a.quantity) * parseNum(entry.soldPrices[a.ticker])), 0);
              const hTotalUSD_Now_Prev = hTotalARS_Now_Prev / parseNum(entry.usdRate || 1);
              const hAlfa = hTotalUSD_Now_Prev > 0 ? ((hTotalUSD_Now / hTotalUSD_Now_Prev) - 1) * 100 : 0;

              return (
                <div key={idx} style={{ backgroundColor: '#fff', padding: '18px', borderRadius: '20px', border: '1px solid #eaecef', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#1a1d21' }}>{entry.date}</div>
                      <div style={{ fontSize: '11px', color: '#adb5bd', fontWeight: 600, marginTop: '2px' }}>Dólar: {fmtARS(entry.usdRate)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '14px', fontWeight: 900, color: hAlfa >= 0 ? '#198754' : '#dc3545' }}>ALFA: {hAlfa > 0 ? '+' : ''}{hAlfa.toFixed(1)}%</div>
                      <div style={{ fontSize: '11px', color: '#6c757d', fontWeight: 700, marginTop: '2px' }}>{fmtUSD(hTotalUSD_Now)}</div>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid #f8f9fa', paddingTop: '12px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 800, color: '#adb5bd', marginBottom: '6px' }}>POSICIÓN COMPRADA</div>
                    {historicAssets.map(a => (
                      <div key={a.ticker} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 800, color: '#1a1d21' }}>{a.ticker} <span style={{ fontWeight: 600, color: '#adb5bd' }}>(x{fmtQty(a.quantity)})</span></span>
                        <span style={{ fontWeight: 800, color: '#0d6efd' }}>{viewCurrency === 'USD' ? fmtUSD(parseNum(entry.prices[a.ticker]) / parseNum(entry.usdRate || 1)) : fmtARS(entry.prices[a.ticker])}</span>
                      </div>
                    ))}
                    
                    <div style={{ fontSize: '10px', fontWeight: 800, color: '#adb5bd', marginTop: '12px', marginBottom: '6px' }}>POSICIÓN VENDIDA (REF)</div>
                    {(event.soldAssets || []).map(a => (
                      <div key={a.ticker} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 800, color: '#6c757d' }}>{a.ticker} <span style={{ fontWeight: 600, color: '#adb5bd' }}>(x{fmtQty(a.quantity)})</span></span>
                        <span style={{ fontWeight: 800, color: '#6c757d' }}>{viewCurrency === 'USD' ? fmtUSD(parseNum(entry.soldPrices[a.ticker]) / parseNum(entry.usdRate || 1)) : fmtARS(entry.soldPrices[a.ticker])}</span>
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
