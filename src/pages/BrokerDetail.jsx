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

  const handleAddAsset = () => setAssets([...assets, { ticker: '', quantity: 0, price: 0 }]);
  const handleRemove = (index) => setAssets(assets.filter((_, i) => i !== index));
  const handleUpdate = (index, field, value) => {
    const newAssets = [...assets];
    newAssets[index][field] = field === 'ticker' ? value.toUpperCase() : Number(value);
    setAssets(newAssets);
  };

  const save = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, "brokerPositions", id), { assets });
      navigate('/');
    } catch (e) { alert("Error al guardar"); }
    finally { setSaving(false); }
  };

  const total = assets.reduce((sum, a) => sum + (a.quantity * a.price), 0);

  if (loading) return <div style={{ padding: '50px', textAlign: 'center' }}>Cargando...</div>;

  return (
    <div style={{ padding: '24px 15px', maxWidth: '600px', margin: 'auto', paddingBottom: '100px' }}>
      <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#0d6efd', fontWeight: 600, marginBottom: 20 }}>← Volver</button>
      <h2 style={{ fontSize: '28px', fontWeight: 900 }}>{brokerNames[id]}</h2>
      <div style={{ fontSize: '24px', fontWeight: 800, color: '#198754', marginBottom: '30px' }}>US$ {total.toLocaleString()}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        {assets.map((asset, index) => (
          <div key={index} style={{ backgroundColor: 'white', padding: '15px', borderRadius: '18px', border: '1px solid #eee' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <input placeholder="TICKER" value={asset.ticker} onChange={(e) => handleUpdate(index, 'ticker', e.target.value)} style={{ fontWeight: 800, border: 'none', outline: 'none' }} />
              <button onClick={() => handleRemove(index)} style={{ color: 'red', border: 'none', background: 'none' }}>X</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
              <input type="number" placeholder="Cant" value={asset.quantity} onChange={(e) => handleUpdate(index, 'quantity', e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #eee' }} />
              <input type="number" placeholder="Precio" value={asset.price} onChange={(e) => handleUpdate(index, 'price', e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #eee' }} />
              <div style={{ textAlign: 'right', fontWeight: 700 }}>${(asset.quantity * asset.price).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>

      <button onClick={handleAddAsset} style={{ width: '100%', padding: '15px', marginTop: '10px', borderRadius: '15px', border: '1px dashed #ccc', fontWeight: 700 }}>+ Agregar Especie</button>
      <button onClick={save} disabled={saving} style={{ position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', width: '90%', maxWidth: '540px', padding: '20px', backgroundColor: '#1a1d21', color: 'white', borderRadius: '20px', fontWeight: 800, border: 'none' }}>
        {saving ? 'Guardando...' : 'Guardar Posición'}
      </button>
    </div>
  );
}
