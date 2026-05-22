import { useState, useEffect } from 'react';
import { collection, getDocs, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { db, auth } from '../firebase/config';
import { Link } from 'react-router-dom';
import { fetchAllPrices, getMepRate, isBondTicker } from '../utils/priceService';
import * as XLSX from 'xlsx';

const handleLogout = async () => {
  sessionStorage.removeItem('bioUnlocked');
  await signOut(auth);
};

const KICKER = "font-mono text-[12px] tracking-[0.22em] uppercase text-teal-400 flex items-center gap-1.5";

export default function Dashboard() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingPrices, setUpdatingPrices] = useState(false);

  const parseNum = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    return Number(val.toString().replace(/\./g, '').replace(',', '.')) || 0;
  };

  const fetchEvents = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "rotations"));
      let data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => {
        if (a.isClosed === b.isClosed) return new Date(b.tradeDate) - new Date(a.tradeDate);
        return a.isClosed ? 1 : -1;
      });
      setEvents(data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => { fetchEvents(); }, []);

  const handleDelete = async (e, id) => {
    e.preventDefault(); e.stopPropagation();
    if (window.confirm("¿Estás seguro de eliminar esta operación?")) {
      try {
        await deleteDoc(doc(db, "rotations", id));
        setEvents(events.filter(ev => ev.id !== id));
      } catch (err) { alert("Error al borrar."); }
    }
  };

  const handleUpdatePrices = async () => {
    setUpdatingPrices(true);
    try {
      const priceMap = await fetchAllPrices();
      const nowIso = new Date().toISOString();
      const timeStr = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

      const rotSnap = await getDocs(collection(db, "rotations"));
      for (const d of rotSnap.docs) {
        const data = d.data();
        if (data.isClosed) continue;
        let changed = false;
        const curP = { ...(data.currentPricesFromDb || {}) };
        const soldP = { ...(data.soldCurrentPricesFromDb || {}) };

        ;(data.boughtAssetsFromDb || data.boughtAssets || []).forEach(a => {
          const t = a.ticker?.toUpperCase().trim();
          if (t && priceMap[t]) { curP[t] = priceMap[t]; changed = true; }
        });
        ;(data.soldAssets || []).forEach(a => {
          const t = a.ticker?.toUpperCase().trim();
          if (t && priceMap[t]) { soldP[t] = priceMap[t]; changed = true; }
        });

        if (changed) await updateDoc(doc(db, "rotations", d.id), { currentPricesFromDb: curP, soldCurrentPricesFromDb: soldP, lastUpdated: timeStr });
      }

      const brokSnap = await getDocs(collection(db, "brokerPositions"));
      for (const d of brokSnap.docs) {
        const data = d.data();
        const updatedAssets = (data.assets || []).map(a => {
          const t = a.ticker?.toUpperCase().trim();
          if (t && priceMap[t]) return { ...a, price: priceMap[t] };
          return a;
        });
        await updateDoc(doc(db, "brokerPositions", d.id), { assets: updatedAssets, lastUpdated: nowIso });
      }

      alert("Sincronización completada.");
      window.location.reload();
    } catch (error) {
      alert("Error: " + error.message);
    } finally {
      setUpdatingPrices(false);
    }
  };

  const exportMaeData = async () => {
    try {
      const maeRes = await fetch('/api/mae/mercado/cotizaciones/rentafija', {
        headers: { 'x-api-key': import.meta.env.VITE_MAE_API_KEY }
      });
      const json = await maeRes.json();
      const lista = json.data || json;
      let csv = "Ticker;Precio Ultimo;Precio Cierre;Variacion;Volumen;Segmento;Descripcion\n";
      lista.forEach(i => {
        csv += `${i.ticker};${i.precioUltimo};${i.precioCierre};${i.variacion};${i.volumenAcumulado};${i.segmento};${i.descripcion}\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'data_mae_completa.csv'; a.click();
    } catch (error) {
      alert("Error al descargar datos: " + error.message);
    }
  };

  const exportarCartera = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "brokerPositions"));
      const filas = [];
      querySnapshot.forEach((document) => {
        const data = document.data();
        const brokerId = document.id;
        let brokerName = brokerId === 'jpm' ? 'J.P. Morgan' : brokerId === 'one' ? 'One618' : 'Latin Securities';
        const rate = brokerId === 'jpm' ? 1 : (parseNum(data.usdRate) || 1);
        (data.assets || []).forEach(asset => {
          const isBond = asset.isBond || isBondTicker(asset.ticker);
          const divisor = isBond ? 100 : 1;
          const cantidad = parseNum(asset.quantity);
          const precio = parseNum(asset.price);
          const subtotalUSD = (cantidad * precio) / divisor / rate;
          filas.push({ "Origen": brokerName, "Especie / Ticker": asset.ticker, "Clase": isBond ? "Bono" : "Acción/Fondo", "Cantidad Nominal": cantidad, "Precio (Origen)": precio, "T.C. (Dólar)": rate === 1 ? "1 (USD)" : rate, "Valorizado (USD)": parseFloat(subtotalUSD.toFixed(2)) });
        });
        const debt = parseNum(data.debt);
        if (debt > 0) {
          filas.push({ "Origen": brokerName, "Especie / Ticker": "CAUCIÓN / DEUDA", "Clase": "Obligación", "Cantidad Nominal": 1, "Precio (Origen)": -debt, "T.C. (Dólar)": "1 (USD)", "Valorizado (USD)": -debt });
        }
      });
      const hoja = XLSX.utils.json_to_sheet(filas);
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hoja, "Posición Consolidada");
      const fecha = new Date().toLocaleDateString('es-AR').replace(/\//g, '-');
      XLSX.writeFile(libro, `Cartera_Marcos_${fecha}.xlsx`);
    } catch (error) {
      alert("Error al exportar cartera a Excel: " + error.message);
    }
  };

  const getBadgeClasses = (val) => {
    if (val > 0.1) return 'bg-teal-400/10 text-teal-300 border border-teal-400/30';
    if (val < -0.1) return 'bg-red-400/10 text-red-300 border border-red-400/30';
    return 'bg-[#1a2428] text-[#A8C8C8] border border-[#2a3a40]';
  };

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen bg-[#080F12]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-[#1e3040] border-t-teal-400 rounded-full animate-spin" />
        <p className="font-mono text-[13px] tracking-[0.22em] uppercase text-[#5B8A8A] animate-pulse">Cargando...</p>
      </div>
    </div>
  );

  return (
    <div className="px-5 pt-8 pb-28 max-w-[600px] mx-auto font-[Space_Grotesk,system-ui,sans-serif] bg-[#080F12] min-h-screen relative overflow-hidden">
      <div className="pointer-events-none absolute top-[-150px] right-[-200px] w-[600px] h-[500px] rounded-full bg-teal-400/[0.04] blur-[100px]" />

      {/* Header */}
      <div className="bg-[#122329] border border-teal-400/15 p-5 rounded-2xl mb-6 shadow-[0_20px_40px_rgba(0,0,0,0.3)] relative z-10">
        <p className={KICKER}>
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2DD4BF]" />
          Gestión de Cartera
        </p>
        <div className="flex justify-between items-center mt-1">
          <h2 className="text-2xl font-bold tracking-tight text-[#F0FAFA]">Estrategias</h2>
          <div className="flex gap-2">
            <button
              onClick={exportarCartera}
              className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 bg-teal-400/10 border border-teal-400/20 hover:border-teal-400/50 text-teal-400 rounded-lg transition-colors"
            >
              Excel
            </button>
            <button
              onClick={exportMaeData}
              className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 bg-[#0C1518] border border-teal-400/15 hover:border-teal-400/30 text-[#A8C8C8] rounded-lg transition-colors"
            >
              MAE
            </button>
            <button
              onClick={handleUpdatePrices}
              disabled={updatingPrices}
              className="w-8 h-8 bg-[#0C1518] border border-teal-400/15 hover:border-teal-400/30 flex items-center justify-center text-teal-400 rounded-lg transition-colors disabled:opacity-50"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={updatingPrices ? 'animate-spin' : ''}>
                <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Events list */}
      <div className="flex flex-col gap-4 relative z-10">
        {events.map(event => {
          const soldAssets = event.soldAssets || [];
          const boughtAssets = event.boughtAssetsFromDb || event.boughtAssets || [];
          const currentPrices = event.currentPricesFromDb || {};
          const soldCurrentPrices = event.soldCurrentPricesFromDb || {};
          const initialUsdRate = event.initialUsdRate || 1;
          const currentUsdRate = event.currentUsdRateFromDb || initialUsdRate;

          const totalARS_Init = soldAssets.reduce((sum, a) => sum + (parseNum(a.quantity) * parseNum(a.priceAtTrade)), 0);
          const totalUSD_Init = totalARS_Init / initialUsdRate;
          const totalARS_Now = boughtAssets.reduce((sum, a) => sum + (parseNum(a.quantity) * (currentPrices[a.ticker] || parseNum(a.priceAtTrade) || 0)), 0);
          const totalUSD_Now = totalARS_Now / currentUsdRate;
          const totalARS_Now_Prev = soldAssets.reduce((sum, a) => sum + (parseNum(a.quantity) * (soldCurrentPrices[a.ticker] || parseNum(a.priceAtTrade) || 0)), 0);
          const totalUSD_Now_Prev = totalARS_Now_Prev / currentUsdRate;

          const pUSD = totalUSD_Init > 0 ? ((totalUSD_Now / totalUSD_Init) - 1) * 100 : 0;
          const pARS = totalARS_Init > 0 ? ((totalARS_Now / totalARS_Init) - 1) * 100 : 0;
          const pALFA = totalUSD_Now_Prev > 0 ? ((totalUSD_Now / totalUSD_Now_Prev) - 1) * 100 : 0;

          return (
            <Link key={event.id} to={`/evento/${event.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className={`bg-[#122329] border border-teal-400/10 hover:border-teal-400/25 rounded-2xl p-5 relative transition-colors ${event.isClosed ? 'opacity-60' : ''}`}>

                <button
                  onClick={(e) => handleDelete(e, event.id)}
                  className="absolute top-4 right-4 font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 bg-red-400/10 border border-red-400/20 hover:border-red-400/50 text-red-400 rounded-lg transition-colors z-10"
                >
                  Borrar
                </button>

                <div className="mb-4">
                  <h3 className="text-lg font-bold text-[#F0FAFA] mb-2 pr-20 leading-tight">{event.eventName}</h3>
                  <div className="flex gap-2 items-center mb-4">
                    <span className="font-mono text-[11px] tracking-[0.12em] uppercase text-[#5B8A8A] bg-[#0C1518] border border-teal-400/10 px-2 py-1 rounded-lg">
                      {event.tradeDate}
                    </span>
                    {event.isClosed && (
                      <span className="font-mono text-[11px] tracking-[0.12em] uppercase text-[#A8C8C8] bg-[#1a2428] border border-[#2a3a40] px-2 py-1 rounded-lg">
                        Cerrada
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 bg-[#0C1518] border border-teal-400/10 p-3 rounded-xl">
                    <div>
                      <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-teal-400/70 mb-1">Valor Actual</div>
                      <div className="text-lg font-black text-[#F0FAFA]">US$ {totalUSD_Now.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                      <div className="font-mono text-[12px] text-teal-400/60 mt-0.5">$ {totalARS_Now.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A] mb-1">Invertido</div>
                      <div className="text-lg font-black text-[#A8C8C8]">US$ {totalUSD_Init.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                      <div className="font-mono text-[12px] text-[#5B8A8A] mt-0.5">$ {totalARS_Init.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'REND. USD', val: pUSD },
                    { label: 'REND. ARS', val: pARS },
                    { label: 'ALFA', val: pALFA },
                  ].map(({ label, val }) => (
                    <div key={label} className={`text-center py-3 rounded-xl ${getBadgeClasses(val)}`}>
                      <div className="font-mono text-[8px] tracking-[0.15em] uppercase mb-1 opacity-80">{label}</div>
                      <div className="text-base font-black">{val >= 0 ? '+' : ''}{val.toFixed(1)}%</div>
                    </div>
                  ))}
                </div>
              </div>
            </Link>
          );
        })}

        {events.length === 0 && (
          <div className="text-center py-16 bg-[#0C1518] border border-teal-400/10 rounded-2xl">
            <p className="text-3xl mb-3 text-[#5B8A8A]">—</p>
            <p className="font-semibold text-[#A8C8C8]">Sin estrategias</p>
            <p className="font-mono text-[12px] text-[#5B8A8A] mt-1 tracking-[0.1em]">Creá una nueva para comenzar</p>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[600px] bg-[#0C1518] border-t border-teal-400/10 flex justify-around px-4 pt-3 pb-6 z-[1000]">
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Brokers</span>
        </Link>
        <Link to="/unificada" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Cartera</span>
        </Link>
        <Link to="/rotaciones" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#2DD4BF', flex: 1 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="18" y="3" width="4" height="18"/><rect x="10" y="8" width="4" height="13"/><rect x="2" y="13" width="4" height="8"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Estrategias</span>
        </Link>
        <button onClick={handleLogout} style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#5B8A8A', flex: 1, cursor: 'pointer', padding: 0 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase">Salir</span>
        </button>
      </div>
    </div>
  );
}
