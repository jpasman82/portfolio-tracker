import { Link } from 'react-router-dom';

export default function Home() {
  // Datos de ejemplo (puedes editarlos aquí manualmente por ahora)
  const brokers = [
    { 
      name: 'JP Morgan', 
      balance: 15500, // <--- CAMBIA ESTE NÚMERO
      color: '#004a99', // Azul JPM
      shortName: 'JPM',
      logoBg: '#e6f0f9'
    },
    { 
      name: 'One618', 
      balance: 83200, // <--- CAMBIA ESTE NÚMERO
      color: '#1a1d21', // Negro/Gris One
      shortName: '1',
      logoBg: '#e9ecef'
    },
    { 
      name: 'Latin Securities', 
      balance: 42150, // <--- CAMBIA ESTE NÚMERO
      color: '#ce9c2b', // Dorado Latin
      shortName: 'LS',
      logoBg: '#fdf8e9'
    }
  ];

  // Calculamos el total automáticamente
  const totalConsolidado = brokers.reduce((sum, b) => sum + b.balance, 0);

  return (
    <div style={{ padding: '24px 15px', maxWidth: '600px', margin: 'auto', backgroundColor: '#f8f9fa', minHeight: '100vh' }}>
      
      {/* HEADER CON TÍTULO */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 900, margin: 0, color: '#1a1d21' }}>Hola, Marcos</h2>
        <span style={{ fontSize: '12px', color: '#6c757d', fontWeight: 600 }}>USD Actualizado</span>
      </div>

      {/* TARJETA TOTAL CONSOLIDADO */}
      <div style={{ 
        padding: '30px 20px', 
        backgroundColor: '#1a1d21', // Fondo oscuro para destacar
        borderRadius: '28px', 
        marginBottom: '25px', 
        boxShadow: '0 10px 20px rgba(0,0,0,0.1)',
        color: 'white'
      }}>
        <div style={{ fontSize: '13px', fontWeight: 700, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
          Total Consolidado
        </div>
        <div style={{ fontSize: '36px', fontWeight: 900, letterSpacing: '-1px' }}>
          US$ {totalConsolidado.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </div>
        <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '5px' }}>
          Suma de posiciones en 3 brokers
        </div>
      </div>

      {/* LISTA DE BROKERS */}
      <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#6c757d', marginBottom: '15px', paddingLeft: '5px' }}>Detalle por Broker</h3>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '35px' }}>
        {brokers.map(b => (
          <div key={b.name} style={{ 
            padding: '18px', 
            backgroundColor: 'white', 
            borderRadius: '20px', 
            border: '1px solid #eaecef', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            boxShadow: '0 2px 6px rgba(0,0,0,0.02)' 
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              {/* LOGO REFERENCIA (Estilo minimalista con iniciales) */}
              <div style={{ 
                width: '45px', 
                height: '45px', 
                borderRadius: '12px', 
                backgroundColor: b.logoBg, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                border: `1px solid ${b.color}20` // Borde muy suave del color del broker
              }}>
                <span style={{ fontSize: '18px', fontWeight: 900, color: b.color }}>
                  {b.shortName}
                </span>
              </div>
              
              <div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: '#1a1d21' }}>{b.name}</div>
                <div style={{ fontSize: '12px', color: '#adb5bd', fontWeight: 600 }}>Posición total</div>
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '18px', fontWeight: 900, color: '#1a1d21' }}>
                US$ {b.balance.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* SECCIÓN INFERIOR - ACCESO A MÓDULOS */}
      <div style={{ borderTop: '1px solid #eaecef', paddingTop: '25px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#6c757d', marginBottom: '15px', paddingLeft: '5px' }}>Herramientas</h3>
        
        <Link to="/rotaciones" style={{ 
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          padding: '18px', 
          backgroundColor: 'white', 
          color: '#1a1d21', 
          textDecoration: 'none', 
          borderRadius: '20px', 
          textAlign: 'center', 
          fontWeight: 800,
          border: '1px solid #1a1d21',
          transition: 'all 0.2s ease',
          boxShadow: '0 4px 6px rgba(0,0,0,0.05)'
        }}>
          <span style={{fontSize: '18px'}}>🔄</span> Tracker de Estrategias (De María)
        </Link>
      </div>

    </div>
  );
}
