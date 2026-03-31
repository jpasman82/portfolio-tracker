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

  const brokerNames = { jpm: 'JP Morgan', one: 'One618', latin: 'Latin Securities' };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const docSnap = await getDoc(doc(db, "brokerPositions", id));
        if (docSnap.exists()) setAssets(docSnap.data().assets || []);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    fetchData();
  }, [id]);

  const handleAddAsset = () => setAssets([...assets, { ticker: '', quantity: '', price: '' }]);
  const handleRemove = (index) => setAssets(assets.filter((_, i) => i !== index));
  const handleUpdate = (index, field, value) => {
    const newAssets = [...assets];
    newAssets[index][field] = field === 'ticker' ? value.toUpperCase() : value;
    setAssets(newAssets);
  };

  const save = async () => {
    setSaving(true);
    try {
      const cleanAssets = assets.map(a => ({
        ticker: a.ticker,
        quantity: Number(a.quantity),
        price: Number(a.price)
      }));
      await setDoc(doc(db, "brokerPositions", id), { 
        assets: cleanAssets,
        lastUpdated: new Date().toISOString()
      });
      navigate('/');
    } catch (e) { alert("Error al guardar"); }
    finally { setSaving(false); }
  };

  const total = assets.reduce((sum, a) => sum + (Number(a.quantity) * Number(a.price)), 0);

  if (loading) return <div style={{ padding: '50px', textAlign: 'center', fontWeight: 800 }}>Cargando...</div>;

  return (
    <div style={{ padding: '24px 15px', maxWidth: '600px', margin: 'auto', paddingBottom: '120px' }}>
      <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#0d6efd', fontWeight: 600, marginBottom: 20, padding: 0, fontSize: '15px' }}>← Volver</button>
      
      <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '24px', border: '1px solid #eaecef', marginBottom: '24px', boxShadow: '0 4px 15px rgba(0,0,0,0.03)' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 8px 0', color: '#6c757d' }}>{brokerNames[id]}</h2>
        <div style={{ fontSize: '32px', fontWeight: 900, color: '#1a1d21' }}>US$ {total.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {assets.map((asset, index) => (
          <div key={index} style={{ backgroundColor: 'white', padding: '20px', borderRadius: '24px', border: '1px solid #eaecef', boxShadow: '0 4px 10px rgba(0,0,0,0.02)' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <input 
                placeholder="TICKER" 
                value={asset.ticker} 
                onChange={(e) => handleUpdate(index, 'ticker', e.target.value)} 
                style={{ fontWeight: 900, border: 'none', outline: 'none', fontSize: '20px', width: '120px', color: '#1a1d21', backgroundColor: 'transparent' }} 
              />
              <button onClick={() => handleRemove(index)} style={{ color: '#ff3b30', border: 'none', background: '#fff0f0', padding: '6px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: 800 }}>BORRAR</button>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '10px', fontWeight: 800, color: '#adb5bd', marginBottom: '6px' }}>CANTIDAD</label>
                <input 
                  type="number" 
                  value={asset.quantity} 
                  onChange={(e) => handleUpdate(index, 'quantity', e.target.value)} 
                  style={{ width: '100%', padding: '12px', borderRadius: '12px', border: 'none', backgroundColor: '#f8f9fa', fontSize: '16px', fontWeight: 700, boxSizing: 'border-box', outline: 'none' }} 
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', fontWeight: 800, color: '#adb5bd', marginBottom: '6px' }}>PRECIO (USD)</label>
                <input 
                  type="number" 
                  value={asset.price} 
                  onChange={(e) => handleUpdate(index, 'price', e.target.value)} 
                  style={{ width: '100%', padding: '12px', borderRadius: '12px', border: 'none', backgroundColor: '#f8f9fa', fontSize: '16px', fontWeight: 700, boxSizing: 'border-box', outline: 'none' }} 
                />
              </div>
            </div>
            
            <div style={{ borderTop: '1px solid #eaecef', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#adb5bd' }}>SUBTOTAL</span>
              <span style={{ fontSize: '16px', fontWeight: 900, color: '#198754' }}>US$ {(Number(asset.quantity) * Number(asset.price)).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
            </div>

          </div>
        ))}
      </div>

      <button onClick={handleAddAsset} style={{ width: '100%', padding: '18px', marginTop: '20px', borderRadius: '20px', border: '2px dashed #dee2e6', backgroundColor: 'transparent', color: '#6c757d', fontWeight: 800, fontSize: '14px' }}>+ Nueva Especie</button>
      
      <button onClick={save} disabled={saving} style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', width: 'calc(100% - 30px)', maxWidth: '570px', padding: '20px', backgroundColor: '#1a1d21', color: 'white', borderRadius: '20px', fontWeight: 800, fontSize: '16px', border: 'none', boxShadow: '0 8px 20px rgba(0,0,0,0.15)' }}>
        {saving ? 'Guardando...' : 'Confirmar Cambios'}
      </button>
    </div>
  );
}
