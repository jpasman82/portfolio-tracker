import { Link } from 'react-router-dom';

export default function Home() {
  const brokers = [
    { 
      name: 'JP Morgan', 
      balance: 0, 
      logo: 'https://logo.clearbit.com/jpmorgan.com',
      color: '#004a99'
    },
    { 
      name: 'One618', 
      balance: 0, 
      logo: 'https://play-lh.googleusercontent.com/rmyAkju1LNJl3AEF4cN2ef4jGxzmiSfxga17vLkwPDc-nyDkkxP78TEoKj1cxF_xGtLHBs6BWb0ccR5WvhCj',
      color: '#1a1d21'
    },
    { 
      name: 'Latin Securities', 
      balance: 0, 
      logo: 'https://reqlut2.s3.amazonaws.com/uploads/logos/420d0b715847860c019e638a3c54fa61864f5665-5242880.png',
      color: '#ce9c2b'
    }
  ];

  const totalConsolidado = brokers.reduce((sum, b) => sum + b.balance, 0);

  return (
    <div style={{ padding: '24px 15px', maxWidth: '600px', margin: 'auto', backgroundColor: '#f8f9fa', minHeight: '100vh' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 900, margin: 0, color: '#1a1d21' }}>Hola, María</h2>
      </div>

      {/* TARJETA TOTAL CONSOLIDADO */}
      <div style={{ 
        padding: '30px 20px', 
        backgroundColor: '#1a1d21', 
        borderRadius: '28px', 
        marginBottom: '25px', 
        boxShadow: '0 10px 20px rgba(0,0,0,0.1)',
        color: 'white'
      }}>
        <div style={{ fontSize: '13px', fontWeight: 700, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
          Total Consolidado
        </div>
        <div style={{ fontSize: '36px', fontWeight: 900, letterSpacing: '-1px' }}>
          US$ {totalConsolidado.toLocaleString('en-US')}
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
              {/* LOGO DEL BROKER */}
              <div style={{ 
                width: '45px', 
                height: '45px', 
                borderRadius: '12px', 
                backgroundColor: 'white', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                border: '1px solid #eee',
                overflow: 'hidden'
              }}>
                <img 
                  src={b.logo} 
                  alt={b.name} 
                  style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '4px' }} 
                  onError={(e) => { e.target.src = 'https://via.placeholder.com/45?text=' + b.name[0] }}
                />
              </div>
              
              <div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: '#1a1d21' }}>{b.name}</div>
                <div style={{ fontSize: '12px', color: '#adb5bd', fontWeight: 600 }}>Posición total</div>
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '18px', fontWeight: 900, color: '#1a1d21' }}>
                US$ {b.balance.toLocaleString('en-US')}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ACCESO A ROTACIONES */}
      <div style={{ borderTop: '1px solid #eaecef', paddingTop: '25px' }}>
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
          boxShadow: '0 4px 6px rgba(0,0,0,0.05)'
        }}>
          🔄 Tracker de Estrategias (María)
        </Link>
      </div>

    </div>
  );
}
