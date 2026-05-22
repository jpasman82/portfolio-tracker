import { useState } from 'react';
import { auth } from '../firebase/config';
import { signInWithEmailAndPassword } from 'firebase/auth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setError('Datos incorrectos. Revisá tu email y clave.');
      } else {
        setError('Error de conexión: ' + err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', backgroundColor: '#111418', padding: '20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      <div style={{ width: '100%', maxWidth: '400px', backgroundColor: '#1a1d21', padding: '40px 30px', borderRadius: '32px', boxShadow: '0 20px 40px rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.05)' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '35px' }}>
          <div style={{ width: '60px', height: '60px', backgroundColor: '#0d6efd', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 15px auto', boxShadow: '0 10px 20px rgba(13, 110, 253, 0.3)' }}>
            <span style={{ fontSize: '28px', color: 'white' }}>💼</span>
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 900, color: 'white', margin: '0 0 5px 0', letterSpacing: '-0.5px' }}>Portfolio Manager</h1>
          <p style={{ fontSize: '14px', color: '#adb5bd', margin: 0 }}>Acceso seguro</p>
        </div>

        {error && (
          <div style={{ backgroundColor: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.2)', color: '#ff453a', padding: '12px', borderRadius: '12px', fontSize: '13px', fontWeight: 700, marginBottom: '20px', textAlign: 'center' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: '#adb5bd', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Email</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              required
              autoComplete="username"
              style={{ width: '100%', padding: '16px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: 'white', fontSize: '16px', fontWeight: 600, boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
          
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: '#adb5bd', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Contraseña</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              style={{ width: '100%', padding: '16px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: 'white', fontSize: '16px', fontWeight: 600, boxSizing: 'border-box', outline: 'none' }}
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            style={{ width: '100%', padding: '18px', backgroundColor: '#0d6efd', color: 'white', border: 'none', borderRadius: '16px', fontWeight: 900, fontSize: '15px', marginTop: '10px', cursor: 'pointer', boxShadow: '0 8px 20px rgba(13, 110, 253, 0.2)' }}
          >
            {loading ? 'Procesando...' : 'Ingresar'}
          </button>
        </form>

      </div>
    </div>
  );
}