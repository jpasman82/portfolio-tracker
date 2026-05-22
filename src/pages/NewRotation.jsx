import { useState } from 'react';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useNavigate } from 'react-router-dom';

export default function NewRotation() {
  const [eventName, setEventName] = useState('');
  const [tradeDate, setTradeDate] = useState(new Date().toISOString().split('T')[0]);
  const [initialUsdRate, setInitialUsdRate] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, "rotations"), {
        eventName, tradeDate, initialUsdRate: Number(initialUsdRate),
        soldAssets: [], boughtAssets: [], isClosed: false
      });
      navigate('/rotaciones');
    } catch (e) { alert("Error al crear"); }
  };

  return (
    <div style={{ padding: '24px 15px', maxWidth: '500px', margin: 'auto' }}>
      <button onClick={() => navigate('/rotaciones')} style={{ background: 'none', border: 'none', color: '#0d6efd', fontWeight: 600, marginBottom: 20 }}>← Volver</button>
      <h2 style={{ fontWeight: 900 }}>Nueva Estrategia</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <input placeholder="Nombre (ej: Rotación GD30 a AL30)" value={eventName} onChange={e => setEventName(e.target.value)} style={{ padding: '15px', borderRadius: '12px', border: '1px solid #eee' }} />
        <input type="date" value={tradeDate} onChange={e => setTradeDate(e.target.value)} style={{ padding: '15px', borderRadius: '12px', border: '1px solid #eee' }} />
        <input placeholder="Dólar MEP del día" type="number" value={initialUsdRate} onChange={e => setInitialUsdRate(e.target.value)} style={{ padding: '15px', borderRadius: '12px', border: '1px solid #eee' }} />
        <button type="submit" style={{ padding: '20px', backgroundColor: '#1a1d21', color: 'white', borderRadius: '16px', fontWeight: 800, border: 'none' }}>Crear Operación</button>
      </form>
    </div>
  );
}
