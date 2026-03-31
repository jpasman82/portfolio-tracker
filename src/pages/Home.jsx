import { Link } from 'react-router-dom';

export default function Home() {
  const brokers = [
    { name: 'JP Morgan', balance: 0, color: '#004a99' },
    { name: 'One618', balance: 0, color: '#1a1d21' },
    { name: 'Latin Securities', balance: 0, color: '#ce9c2b' }
  ];

  return (
    <div style={{ padding: '24px 15px', maxWidth: '600px', margin: 'auto' }}>
      <h2 style={{ fontSize: '26px', fontWeight: 900, marginBottom: '24px' }}>Resumen de Cuenta</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '30px' }}>
        {brokers.map(b => (
          <div key={b.name} style={{ padding: '20px', backgroundColor: 'white', borderRadius: '24px', border: '1px solid #eee', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
            <div style={{ fontSize: '12px', fontWeight: 800, color: b.color, textTransform: 'uppercase', marginBottom: '5px' }}>{b.name}</div>
            <div style={{ fontSize: '24px', fontWeight: 900 }}>US$ {b.balance.toLocaleString()}</div>
          </div>
        ))}
      </div>
      <Link to="/rotaciones" style={{ display: 'block', padding: '20px', backgroundColor: '#1a1d21', color: 'white', textDecoration: 'none', borderRadius: '20px', textAlign: 'center', fontWeight: 800 }}>
        🔄 Ver Estrategias de María
      </Link>
    </div>
  );
}
