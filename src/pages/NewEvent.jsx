import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../firebase/config';
import { collection, addDoc, doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

export default function NewEvent() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditing = Boolean(id);

  const [eventName, setEventName] = useState('');
  const [tradeDate, setTradeDate] = useState('');
  const [initialUsdRate, setInitialUsdRate] = useState('');
  const [soldAssets, setSoldAssets] = useState([{ ticker: '', quantity: '', priceAtTrade: '' }]);
  const [boughtAssets, setBoughtAssets] = useState([{ ticker: '', quantity: '', priceAtTrade: '' }]);
  const [isClosed, setIsClosed] = useState(false); 

  useEffect(() => {
    if (isEditing) {
      const fetchEvent = async () => {
        const docRef = doc(db, "rotations", id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setEventName(data.eventName);
          setTradeDate(data.tradeDate);
          setInitialUsdRate(data.initialUsdRate);
          setSoldAssets(data.soldAssets);
          setBoughtAssets(data.boughtAssets);
          setIsClosed(data.isClosed || false);
        }
      };
      fetchEvent();
    }
  }, [id, isEditing]);

  const handleAssetChange = (index, field, value, type) => {
    const isSold = type === 'sold';
    const currentAssets = isSold ? [...soldAssets] : [...boughtAssets];
    currentAssets[index][field] = value;
    isSold ? setSoldAssets(currentAssets) : setBoughtAssets(currentAssets);
  };

  const addAssetRow = (type) => {
    const isSold = type === 'sold';
    const newRow = { ticker: '', quantity: '', priceAtTrade: '' };
    isSold ? setSoldAssets([...soldAssets, newRow]) : setBoughtAssets([...boughtAssets, newRow]);
  };

  const handleSaveEvent = async () => {
    if (!eventName || !tradeDate || !initialUsdRate) {
      alert("Por favor completá los campos básicos.");
      return;
    }
    const eventData = {
      clientId: "cliente_001",
      eventName,
      tradeDate,
      initialUsdRate: Number(initialUsdRate),
      soldAssets: soldAssets.map(a => ({ ticker: a.ticker.toUpperCase(), quantity: Number(a.quantity), priceAtTrade: Number(a.priceAtTrade) })),
      boughtAssets: boughtAssets.map(a => ({ ticker: a.ticker.toUpperCase(), quantity: Number(a.quantity), priceAtTrade: Number(a.priceAtTrade) })),
      isClosed: isClosed 
    };

    try {
      if (isEditing) {
        await updateDoc(doc(db, "rotations", id), eventData);
      } else {
        await addDoc(collection(db, "rotations"), eventData);
      }
      navigate('/');
    } catch (error) {
      console.error("Error al guardar:", error);
      alert("Error al guardar.");
    }
  };

  const handleDelete = async () => {
    if (window.confirm("¿Confirmás la eliminación definitiva?")) {
      await deleteDoc(doc(db, "rotations", id));
      navigate('/');
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '12px',
    borderRadius: '10px',
    border: '1px solid #ced4da',
    fontSize: '16px',
    marginBottom: '10px',
    backgroundColor: '#fff',
    outline: 'none',
    boxSizing: 'border-box'
  };

  return (
    <div style={{ padding: '24px 0', maxWidth: '500px', margin: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 800, margin: 0 }}>
          {isEditing ? 'Editar Rotación' : 'Nueva Rotación'}
        </h2>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: '#6c757d', fontWeight: 600, cursor: 'pointer' }}>
          Cancelar
        </button>
      </div>

      {/* ESTADO DE LA OPERACIÓN (SWITCH) */}
      {isEditing && (
        <div style={{ 
          backgroundColor: isClosed ? '#1a1d21' : '#f8f9fa', 
          padding: '15px', 
          borderRadius: '16px', 
          marginBottom: '20px', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '12px',
          border: '1px solid #eaecef',
          transition: 'all 0.3s ease'
        }}>
          <input 
            type="checkbox" 
            id="closedStatus" 
            checked={isClosed} 
            onChange={(e) => setIsClosed(e.target.checked)}
            style={{ width: '22px', height: '22px', cursor: 'pointer' }}
          />
          <label htmlFor="closedStatus" style={{ 
            fontWeight: 700, 
            fontSize: '14px', 
            color: isClosed ? 'white' : '#1a1d21',
            cursor: 'pointer' 
          }}>
            {isClosed ? '🔒 OPERACIÓN CERRADA' : '🔓 OPERACIÓN ABIERTA'}
          </label>
        </div>
      )}

      <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '20px', border: '1px solid #eaecef', marginBottom: '20px' }}>
        <label style={{ fontSize: '12px', fontWeight: 700, color: '#6c757d', marginBottom: '5px', display: 'block' }}>NOMBRE DEL EVENTO</label>
        <input type="text" placeholder="Ej: Venta VISTA compra BBAR" value={eventName} onChange={(e) => setEventName(e.target.value)} style={inputStyle} />

        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#6c757d', marginBottom: '5px', display: 'block' }}>FECHA</label>
            <input type="date" value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#6c757d', marginBottom: '5px', display: 'block' }}>DÓLAR BASE</label>
            <input type="number" placeholder="1400" value={initialUsdRate} onChange={(e) => setInitialUsdRate(e.target.value)} style={inputStyle} />
          </div>
        </div>
      </div>

      {/* SECCIÓN VENTA */}
      <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#dc3545', marginBottom: '10px', paddingLeft: '5px' }}>⬇ LO QUE SE VENDIÓ</h3>
      <div style={{ backgroundColor: '#fff5f5', padding: '15px', borderRadius: '20px', marginBottom: '20px', border: '1px solid #ffdada' }}>
        {soldAssets.map((asset, index) => (
          <div key={`sold-${index}`} style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <input type="text" placeholder="Ticker" value={asset.ticker} onChange={(e) => handleAssetChange(index, 'ticker', e.target.value, 'sold')} style={{ ...inputStyle, marginBottom: 0, flex: 1.5 }} />
            <input type="number" placeholder="Cant" value={asset.quantity} onChange={(e) => handleAssetChange(index, 'quantity', e.target.value, 'sold')} style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
            <input type="number" placeholder="Precio" value={asset.priceAtTrade} onChange={(e) => handleAssetChange(index, 'priceAtTrade', e.target.value, 'sold')} style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
          </div>
        ))}
        <button onClick={() => addAssetRow('sold')} style={{ width: '100%', background: 'none', border: '1px dashed #dc3545', color: '#dc3545', padding: '8px', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>+ Otro activo vendido</button>
      </div>

      {/* SECCIÓN COMPRA */}
      <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#198754', marginBottom: '10px', paddingLeft: '5px' }}>⬆ LO QUE SE COMPRÓ</h3>
      <div style={{ backgroundColor: '#f4faf6', padding: '15px', borderRadius: '20px', marginBottom: '30px', border: '1px solid #d1e7dd' }}>
        {boughtAssets.map((asset, index) => (
          <div key={`bought-${index}`} style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <input type="text" placeholder="Ticker" value={asset.ticker} onChange={(e) => handleAssetChange(index, 'ticker', e.target.value, 'bought')} style={{ ...inputStyle, marginBottom: 0, flex: 1.5 }} />
            <input type="number" placeholder="Cant" value={asset.quantity} onChange={(e) => handleAssetChange(index, 'quantity', e.target.value, 'bought')} style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
            <input type="number" placeholder="Precio" value={asset.priceAtTrade} onChange={(e) => handleAssetChange(index, 'priceAtTrade', e.target.value, 'bought')} style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
          </div>
        ))}
        <button onClick={() => addAssetRow('bought')} style={{ width: '100%', background: 'none', border: '1px dashed #198754', color: '#198754', padding: '8px', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>+ Otro activo comprado</button>
      </div>

      <button onClick={handleSaveEvent} style={{ width: '100%', padding: '18px', backgroundColor: '#1a1d21', color: 'white', border: 'none', borderRadius: '16px', fontSize: '16px', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
        {isEditing ? 'Guardar Cambios' : 'Crear Operación'}
      </button>

      {isEditing && (
        <button onClick={handleDelete} style={{ width: '100%', marginTop: '15px', padding: '10px', background: 'none', border: 'none', color: '#dc3545', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
          Eliminar rotación definitivamente
        </button>
      )}
    </div>
  );
}