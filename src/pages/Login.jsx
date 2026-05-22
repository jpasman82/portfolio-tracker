import { useState } from 'react';
import { auth } from '../firebase/config';
import { signInWithEmailAndPassword } from 'firebase/auth';

const KICKER = "font-mono text-[12px] tracking-[0.22em] uppercase text-teal-400 flex items-center gap-1.5 mb-1";
const INPUT = "w-full px-4 py-3 bg-[#0C1518] border border-teal-400/15 hover:border-teal-400/30 focus:border-teal-400/60 text-[#F0FAFA] placeholder-[#3d5a5a] rounded-xl text-sm outline-none transition-colors";
const LABEL = "block font-mono text-[11px] tracking-[0.22em] uppercase text-[#5B8A8A] mb-2";

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
      sessionStorage.setItem('justLoggedIn', 'true');
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
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#080F12] p-5 font-[Space_Grotesk,system-ui,sans-serif] relative overflow-hidden">
      <div className="pointer-events-none absolute top-[-150px] right-[-200px] w-[600px] h-[500px] rounded-full bg-teal-400/[0.04] blur-[100px]" />
      <div className="pointer-events-none absolute bottom-0 left-[-100px] w-[400px] h-[400px] rounded-full bg-teal-400/[0.03] blur-[100px]" />

      <div className="w-full max-w-[420px] bg-[#122329] border border-teal-400/20 rounded-2xl p-8 shadow-[0_40px_80px_rgba(0,0,0,0.6)] relative z-10">

        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-teal-400/10 border border-teal-400/30 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-[0_0_30px_rgba(45,212,191,0.12)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2DD4BF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
            </svg>
          </div>
          <p className={`${KICKER} justify-center`}>
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2DD4BF]" />
            Acceso seguro
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-[#F0FAFA] mt-1">Portfolio Manager</h1>
        </div>

        {error && (
          <div className="bg-red-400/10 border border-red-400/30 text-red-300 px-4 py-3 rounded-xl font-mono text-[13px] tracking-[0.1em] mb-6 text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <label className={LABEL}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              required
              autoComplete="username"
              className={INPUT}
            />
          </div>

          <div>
            <label className={LABEL}>Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              className={INPUT}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-teal-400 hover:bg-teal-300 text-[#080F12] font-bold rounded-xl font-mono text-[13px] uppercase tracking-[0.18em] shadow-[0_8px_24px_rgba(45,212,191,0.2)] transition-colors mt-2 disabled:opacity-60"
          >
            {loading ? 'Procesando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
