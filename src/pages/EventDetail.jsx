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

  useEffect(() => {
    const fetchData = async () => {
      try {
        const docSnap = await getDoc(doc(db, "rotations", id));
        if (docSnap.exists()) {
          const data = docSnap.data();
          setEvent(data);
          setEventName(data.eventName);
          setCurrentUsdRate(data.currentUsdRateFromDb || data.initialUsdRate);
          const assets = data.boughtAssetsFromDb || data.boughtAssets || [];
          setCurrentAssets(assets);
          const pB = {};
          assets.forEach(a => pB[a.ticker] = data.currentPricesFromDb?.[a.ticker] || a.priceAtTrade || 0);
          setCurrentPrices(pB);
          const pS = {};
          (data.soldAssets || []).forEach(a => pS[a.ticker] = data.soldCurrentPricesFromDb?.[a.ticker] || a.priceAtTrade || 0);
          setSoldCurrentPrices(pS);
        }
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    fetchData();
  }, [id]);

  const save = async (closeValue) => {
    setSaving(true);
    const now = new Date();
    const timestamp = `${now.getDate()}/${now.getMonth() + 1} ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    try {
      await updateDoc(doc(db, "rotations", id), { 
        eventName, 
        boughtAssetsFromDb: currentAssets, 
        currentPricesFromDb: currentPrices, 
        soldCurrentPricesFromDb: soldCurrentPrices, 
        currentUsdRateFromDb: Number(currentUsdRate), 
        isClosed: closeValue,
        lastUpdated: timestamp // GUARDAMOS LA FECHA
      });
      setIsEditingStructure(false); 
      window.location.reload();
    } catch (e) { alert("Error al guardar"); }
    finally { setSaving(false); }
  };

  if (loading || !event) return <div style={{ padding: '100px', textAlign: 'center' }}>Cargando...</div>;

  const totalARS_Init = (event.soldAssets || []).reduce((sum, a) => sum + (a.quantity * a.priceAtTrade), 0);
  const totalUSD_Init = totalARS_Init / (event.initialUsdRate || 1);
  const totalARS_Now = currentAssets.reduce((sum, a) => sum + (a.quantity * (currentPrices[a.ticker] || 0)), 0);
  const totalUSD_Now = totalARS_Now / (Number(currentUsdRate) || event.initialUsdRate || 1);
  const totalARS_Now_Prev = (event.soldAssets || []).reduce((sum, a) => sum + (a.quantity * (soldCurrentPrices[a.ticker] || 0)), 0);
  const totalUSD_Now_Prev = totalARS_Now_Prev / (Number(currentUsdRate) || event.initialUsdRate || 1);

  const pUSD = totalUSD_Init > 0 ? ((totalUSD_Now / totalUSD_Init) - 1) * 100 : 0;
  const pARS = totalARS_Init > 0 ? ((totalARS_Now / totalARS_Init) - 1) * 100 : 0;
  const pALFA = totalUSD_Now_Prev > 0 ? ((totalUSD_Now / totalUSD_Now_Prev) - 1) * 100 : 0;

  return (
    <div style={{ padding: '24px 15px', maxWidth: '500px', margin: 'auto', paddingBottom: '120px' }}>
      <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#0d6efd', fontWeight: 600, marginBottom: 10 }}>← Volver</button>
      
      <div style={{ marginBottom: 20 }}>
        <input value={eventName} onChange={(e) => setEventName(e.target.value)} disabled={!isEditingStructure || event.isClosed} style={{ width: '100%', border: 'none', background: 'transparent', fontSize: '24px', fontWeight: 800, outline: 'none' }} />
        {event.lastUpdated && <div style={{ fontSize: '11px', color: '#adb5bd', fontWeight: 700 }}>Última actualización: {event.lastUpdated} hs</div>}
      </div>
      
      {/* RESTO DEL COMPONENTE IGUAL (PRECIOS, BADGES, ETC.) */}
      <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '24px', border: '1px solid #eee', marginBottom: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
          <div style={{ borderRight: '1px solid #f0f0f0', paddingRight: '10px' }}>
            <div style={{ fontSize: '9px', fontWeight: 800, color: '#adb5bd', textTransform: 'uppercase' }}>Inversión Inicial</div>
            <div style={{ fontSize: '18px', fontWeight: 800 }}>$ {totalARS_Init.toLocaleString('es-AR', {maximumFractionDigits: 0})}</div>
            <div style={{ fontSize: '11px', color: '#b2bec3' }}>US$ {totalUSD_Init.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
          </div>
          <div>
            <div style={{ fontSize: '9px', fontWeight: 800, color: '#198754', textTransform: 'uppercase' }}>Valor Actual</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#198754' }}>$ {totalARS_Now.toLocaleString('es-AR', {maximumFractionDigits: 0})}</div>
            <div style={{ fontSize: '11px', color: '#198754', fontWeight: 700 }}>US$ {totalUSD_Now.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '20px' }}>
        <div style={{ borderRadius: '16px', padding: '12px 5px', textAlign: 'center', backgroundColor: pUSD > 0 ? '#00c805' : '#ff3b30', color: 'white' }}><div style={{ fontSize: '8px', fontWeight: 700 }}>REND. USD</div><div style={{ fontSize: '16px', fontWeight: 800 }}>{pUSD.toFixed(1)}%</div></div>
        <div style={{ borderRadius: '16px', padding: '12px 5px', textAlign: 'center', backgroundColor: pARS > 0 ? '#00c805' : '#ff3b30', color: 'white' }}><div style={{ fontSize: '8px', fontWeight: 700 }}>REND. ARS</div><div style={{ fontSize: '16px', fontWeight: 800 }}>{pARS.toFixed(1)}%</div></div>
        <div style={{ borderRadius: '16px', padding: '12px 5px', textAlign: 'center', backgroundColor: pALFA > 0 ? '#00c805' : '#ff3b30', color: 'white' }}><div style={{ fontSize: '8px', fontWeight: 700 }}>ALFA</div><div style={{ fontSize: '16px', fontWeight: 800 }}>{pALFA.toFixed(1)}%</div></div>
      </div>

      <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '24px', border: '1px solid #eaecef', marginBottom: '15px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px', alignItems: 'center' }}>
          <h4 style={{ margin: 0, fontSize: '13px', color: '#198754' }}>⬆️ POSICIÓN ACTUAL</h4>
          {!event.isClosed && !isEditingStructure && <button onClick={() => setIsEditingStructure(true)} style={{ border: 'none', background: '#f8f9fa', color: '#0d6efd', fontWeight: 700, fontSize: '11px', padding: '5px 10px', borderRadius: 8 }}>✏️ Editar</button>}
        </div>
        {currentAssets.map((asset) => (
          <div key={asset.ticker} style={{ marginBottom: '15px', borderBottom: '1px solid #f8f9fa', paddingBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{asset.ticker}</b></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: 5 }}>
              <div><label style={{ fontSize: '9px' }}>CANTIDAD</label><input type="number" value={asset.quantity} disabled={!isEditingStructure} onChange={(e) => setCurrentAssets(currentAssets.map(a => a.ticker === asset.ticker ? {...a, quantity: Number(e.target.value)} : a))} style={{ width: '100%', padding: '10px', border: '1px solid #eee', borderRadius: 10 }} /></div>
              <div><label style={{ fontSize: '9px' }}>PRECIO ARS</label><input type="number" value={currentPrices[asset.ticker]} disabled={event.isClosed} onChange={(e) => setCurrentPrices({...currentPrices, [asset.ticker]: Number(e.target.value)})} style={{ width: '100%', padding: '10px', border: '1px solid #eee', textAlign: 'right', borderRadius: 10 }} /></div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '20px', border: '1px solid #eaecef', marginBottom: '15px' }}>
        <label style={{ fontSize: '11px', fontWeight: 700 }}>DÓLAR ACTUAL</label>
        <input type="number" value={currentUsdRate} disabled={event.isClosed} onChange={(e) => setCurrentUsdRate(e.target.value)} style={{ width: '100%', border: 'none', fontSize: '20px', fontWeight: 800, outline: 'none' }} />
      </div>

      {event.isClosed ? (
        <button onClick={() => save(false)} style={{ width: '100%', padding: '18px', backgroundColor: 'transparent', color: '#0d6efd', border: '2px solid #0d6efd', borderRadius: '16px', fontWeight: 700 }}>🔓 Reabrir Operación</button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button onClick={() => save(false)} disabled={saving} style={{ width: '100%', padding: '18px', backgroundColor: '#1a1d21', color: 'white', border: 'none', borderRadius: '16px', fontWeight: 700 }}>{saving ? 'Guardando...' : 'Guardar Cambios'}</button>
          <button onClick={() => { if(window.confirm("¿Cerrar?")) save(true) }} style={{ color: '#dc3545', border: 'none', background: 'none', fontSize: '13px', marginTop: 10 }}>Finalizar y cerrar operación</button>
        </div>
      )}
    </div>
  );
}