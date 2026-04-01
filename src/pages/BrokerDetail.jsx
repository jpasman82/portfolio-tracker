import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

export default function BrokerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [usdRate, setUsdRate] = useState('');
  const [debt, setDebt] = useState('');

  const brokerNames = { jpm: 'J.P. Morgan', one: 'One618', latin: 'Latin Securities' };
  const isUSD = id === 'jpm';

  const formatInput = (val) => {
    if (val === undefined || val === null || val === '') return '';
    let str = val.toString();
    
    if (typeof val === 'number') {
      str = str.toString().replace('.', ',');
    }

    if (str.endsWith('.')) {
      str = str.slice(0, -1) + ',';
    }

    let clean = str.replace(/\./g, '');
    clean = clean.replace(/[^0-9,]/g, '');
    
    let parts = clean.split(',');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    
    if (parts.length > 2) {
      parts = [parts[0], parts.slice(1).join('')];
    }
    return parts.join(',');
  };

  const parseNum = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    return Number(val.toString().replace(/\./g, '').replace(',', '.')) || 0;
  };

  const formatDecimals = (val) => {
    return parseNum(val).toFixed(2).replace('.', ',');
  };

  const fmtQty = (v) => formatInput(v);
  const fmtARS = (v) => '$ ' + formatInput(typeof v === 'number' ? v.toFixed(2) : v);
  const fmtUSD = (v) => 'USD ' + formatInput(typeof v === 'number' ? v.toFixed(2) : v);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const docSnap = await getDoc(doc(db, "brokerPositions", id));
        if (docSnap.exists()) {
          const data = docSnap.data();
          const formattedAssets = (data.assets || []).map(a => ({
            ticker: a.ticker,
            quantity: a.quantity?.toString().replace('.', ',') || '',
            price: formatDecimals(a.price)
          }));
          setAssets(formattedAssets);
          if (!isUSD && data.usdRate) {
            setUsdRate(formatDecimals(data.usdRate));
          }
          if (data.debt) {
            setDebt(formatDecimals(data.debt));
          }
        }
      } catch (e) {}
      finally { setLoading(false); }
    };
    fetchData();
  }, [id, isUSD]);

  const handleAddAsset = () => setAssets([...assets, { ticker: '', quantity: '', price: '' }]);
  const handleRemove = (index) => setAssets(assets.filter((_, i) => i !== index));

  const save = async () => {
    setSaving(true);
    try {
      const cleanAssets = assets.map(a => ({
        ticker: a.ticker,
        quantity: parseNum(a.quantity),
        price: parseNum(a.price)
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
  const totalAssetsUSD = assets.reduce((sum, a) => sum + ((parseNum(a.quantity) * parseNum(a.price)) / rate), 0);
  const totalUSD = totalAssetsUSD - parseNum(debt);

  if (loading) return <div style={{ padding: '50px', textAlign: 'center', fontWeight: 800 }}>Cargando...</div>;

  return (
    <div style={{ padding: '24px 15px', maxWidth: '600px', margin: 'auto', paddingBottom: '120px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#0d6efd', fontWeight: 800, padding: 0, fontSize: '14px' }}>
          ← Volver
        </button>
        <button 
          onClick={() => setIsEditing(!isEditing)} 
          style={{ 
            background: isEditing ? '#f8f9fa' : '#1a1d21', 
            color: isEditing ? '#1a1d21' : 'white', 
            border: isEditing ? '1px solid #dee2e6' : 'none', 
            padding: '8px 16px', 
            borderRadius: '12px', 
            fontWeight: 800, 
            fontSize: '13px' 
          }}
        >
          {isEditing ? 'Cancelar Edición' : 'Editar Posición'}
        </button>
      </div>
      
      <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '24px', border: '1px solid #eaecef', marginBottom: '24px', boxShadow: '0 4px 15px rgba(0,0,0,0.03)' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 8px 0', color: '#6c757d' }}>{brokerNames[id]}</h2>
        <div style={{ fontSize: '36px', fontWeight: 900, color: '#1a1d21', letterSpacing: '-1px' }}>
          US$ {totalUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {!isEditing ? (
          assets.map((asset, index) => (
            <div key={index} style={{ backgroundColor: 'white', padding: '20px', borderRadius: '20px', border: '1px solid #eaecef', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 900, color: '#1a1d21' }}>{asset.ticker}</div>
                <div style={{ fontSize: '13px', color: '#adb5bd', fontWeight: 700, marginTop: '4px' }}>
                  {fmtQty(asset.quantity)} nom. a {isUSD ? fmtUSD(parseNum(asset.price)) : fmtARS(parseNum(asset.price))}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '18px', fontWeight: 900, color: '#198754' }}>
                  {fmtUSD((parseNum(asset.quantity) * parseNum(asset.price)) / rate)}
                </div>
              </div>
            </div>
          ))
        ) : (
          assets.map((asset, index) => (
            <div key={index} style={{ backgroundColor: 'white', padding: '20px', borderRadius: '24px', border: '1px solid #0d6efd', boxShadow: '0 4px 10px rgba(13, 110, 253, 0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <input 
                  placeholder="TICKER" 
                  value={asset.ticker} 
                  onChange={(e) => {
                    const newAssets = [...assets];
                    newAssets[index].ticker = e.target.value.toUpperCase();
                    setAssets(newAssets);
                  }} 
                  style={{ fontWeight: 900, border: 'none', outline: 'none', fontSize: '20px', width: '120px', color: '#1a1d21', backgroundColor: 'transparent' }} 
                />
                <button onClick={() => handleRemove(index)} style={{ color: '#ff3b30', border: 'none', background: '#fff0f0', padding: '6px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: 800 }}>BORRAR</button>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', fontWeight: 800, color: '#adb5bd', marginBottom: '6px' }}>CANTIDAD</label>
                  <input 
                    type="text" 
                    value={formatInput(asset.quantity)} 
                    onChange={(e) => {
                      const newAssets = [...assets];
                      newAssets[index].quantity = e.target.value;
                      setAssets(newAssets);
                    }} 
                    style={{ width: '100%', padding: '12px', borderRadius: '12px', border: 'none', backgroundColor: '#f8f9fa', fontSize: '16px', fontWeight: 700, boxSizing: 'border-box', outline: 'none' }} 
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', fontWeight: 800, color: '#adb5bd', marginBottom: '6px' }}>{isUSD ? 'PRECIO (USD)' : 'PRECIO (ARS)'}</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '12px', top: '11px', color: '#1a1d21', fontWeight: 800, fontSize: '14px' }}>{isUSD ? 'U$' : '$'}</span>
                    <input 
                      type="text" 
                      value={formatInput(asset.price)} 
                      onBlur={(e) => {
                        const newAssets = [...assets];
                        newAssets[index].price = formatDecimals(e.target.value);
                        setAssets(newAssets);
                      }}
                      onChange={(e) => {
                        const newAssets = [...assets];
                        newAssets[index].price = e.target.value;
                        setAssets(newAssets);
                      }} 
                      style={{ width: '100%', padding: '12px 12px 12px 34px', borderRadius: '12px', border: 'none', backgroundColor: '#f8f9fa', fontSize: '16px', fontWeight: 700, boxSizing: 'border-box', outline: 'none' }} 
                    />
                  </div>
                </div>
              </div>
              
              <div style={{ borderTop: '1px solid #eaecef', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: '#adb5bd' }}>SUBTOTAL</span>
                <span style={{ fontSize: '16px', fontWeight: 900, color: '#198754' }}>{fmtUSD((parseNum(asset.quantity) * parseNum(asset.price)) / rate)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {isEditing && (
        <button onClick={handleAddAsset} style={{ width: '100%', padding: '18px', marginTop: '20px', borderRadius: '20px', border: '2px dashed #dee2e6', backgroundColor: 'transparent', color: '#6c757d', fontWeight: 800, fontSize: '14px' }}>+ Nueva Especie</button>
      )}

      <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '20px', border: '1px solid #eaecef', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px' }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 900, color: '#1a1d21' }}>Caución / Deuda</div>
          <div style={{ fontSize: '11px', color: '#adb5bd', fontWeight: 700, marginTop: '4px' }}>Obligaciones en USD</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {!isEditing ? (
            <div style={{ fontSize: '18px', fontWeight: 900, color: parseNum(debt) > 0 ? '#ff3b30' : '#1a1d21' }}>
              {parseNum(debt) > 0 ? '-' : ''}{fmtUSD(parseNum(debt))}
            </div>
          ) : (
            <div style={{ position: 'relative', width: '130px' }}>
              <span style={{ position: 'absolute', left: '12px', top: '11px', color: '#ff3b30', fontWeight: 800, fontSize: '14px' }}>U$</span>
              <input 
                type="text" 
                value={formatInput(debt)} 
                onBlur={(e) => setDebt(formatDecimals(e.target.value))} 
                onChange={(e) => setDebt(e.target.value)} 
                style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1px solid rgba(255,59,48,0.3)', backgroundColor: '#fff0f0', color: '#ff3b30', borderRadius: '12px', fontWeight: 800, outline: 'none', boxSizing: 'border-box', fontSize: '15px', textAlign: 'right' }} 
              />
            </div>
          )}
        </div>
      </div>

      {!isUSD && (
        <div style={{ backgroundColor: 'white', padding: '20px 24px', borderRadius: '24px', border: '1px solid #eaecef', marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ fontSize: '13px', fontWeight: 800, color: '#1a1d21' }}>Dólar MEP</label>
          <div style={{ position: 'relative', width: '120px' }}>
            <span style={{ position: 'absolute', left: '0', top: '2px', color: '#1a1d21', fontWeight: 900, fontSize: '18px' }}>$</span>
            <input 
              type="text" 
              value={formatInput(usdRate)} 
              onBlur={(e) => setUsdRate(formatDecimals(e.target.value))} 
              disabled={!isEditing} 
              onChange={(e) => setUsdRate(e.target.value)} 
              style={{ width: '100%', border: 'none', fontSize: '20px', fontWeight: 900, outline: 'none', textAlign: 'right', color: '#1a1d21', backgroundColor: 'transparent', paddingLeft: '15px', boxSizing: 'border-box' }} 
            />
          </div>
        </div>
      )}

      {isEditing && (
        <button onClick={save} disabled={saving} style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', width: 'calc(100% - 30px)', maxWidth: '570px', padding: '20px', backgroundColor: '#0d6efd', color: 'white', borderRadius: '20px', fontWeight: 800, fontSize: '16px', border: 'none', boxShadow: '0 8px 20px rgba(13, 110, 253, 0.3)', zIndex: 1000 }}>
          {saving ? 'Guardando...' : 'Confirmar Cambios'}
        </button>
      )}
    </div>
  );
}
