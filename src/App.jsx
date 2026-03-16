import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import NewEvent from './pages/NewEvent';
import EventDetail from './pages/EventDetail';

function App() {
  return (
    <BrowserRouter>
      <div style={{ 
        minHeight: '100vh', 
        backgroundColor: '#f8f9fa', 
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        color: '#1a1d21'
      }}>
        {/* HEADER CON LOGO */}
        <header style={{ 
          backgroundColor: '#ffffff', 
          padding: '15px 20px', 
          borderBottom: '1px solid #eaecef', 
          display: 'flex', 
          justifyContent: 'center',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: '0 2px 10px rgba(0,0,0,0.03)'
        }}>
          <Link to="/" style={{ textDecoration: 'none' }}>
            <img 
              src="/logo.png"  /* Asegurate de que el archivo esté en la carpeta /public */
              alt="Latinbonos Logo" 
              style={{ 
                height: '45px', // Ajusté el tamaño para que se lea bien el eslogan
                width: 'auto',
                display: 'block'
              }} 
              onError={(e) => {
                // Por si el logo no carga, mostramos el texto como respaldo
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'block';
              }}
            />
            <h1 style={{ display: 'none', margin: 0, fontSize: '20px', color: '#1a1d21' }}>
              Latinbonos Portfolio
            </h1>
          </Link>
        </header>
        
        <main style={{ maxWidth: '600px', margin: 'auto', padding: '0 15px' }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/nuevo" element={<NewEvent />} />
            <Route path="/evento/:id" element={<EventDetail />} />
            <Route path="/editar/:id" element={<NewEvent />} />
          </Routes>
        </main>

        {/* FOOTER OPCIONAL */}
        <footer style={{ textAlign: 'center', padding: '30px 0', color: '#999', fontSize: '11px' }}>
          Agente Asesor Global de Inversiones - CNV N° 199
        </footer>
      </div>
    </BrowserRouter>
  );
}

export default App;