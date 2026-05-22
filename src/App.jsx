import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase/config';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import BrokerDetail from './pages/BrokerDetail';
import EventDetail from './pages/EventDetail';
import Login from './pages/Login';
import Unified from './pages/Unified';
import {
  isPlatformAuthenticatorAvailable,
  isBiometricEnabled,
  registerBiometric,
  authenticateWithBiometric,
  clearBiometric
} from './utils/biometricAuth';

// ── Pantalla de bloqueo biométrico ───────────────────────────────────────────
function BiometricLockScreen({ onUnlock }) {
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleUnlock = async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      await authenticateWithBiometric();
      onUnlock();
    } catch (err) {
      setErrorMsg(
        err.name === 'NotAllowedError'
          ? 'Verificación cancelada. Intentá de nuevo.'
          : 'No se pudo verificar. Intentá de nuevo.'
      );
      setStatus('error');
    }
  };

  const handleSignOut = async () => {
    clearBiometric();
    await signOut(auth);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', backgroundColor: '#111418', padding: '20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: '360px', textAlign: 'center' }}>

        <div style={{ width: '72px', height: '72px', backgroundColor: '#0d6efd', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px auto', boxShadow: '0 10px 30px rgba(13,110,253,0.3)' }}>
          <span style={{ fontSize: '34px' }}>💼</span>
        </div>

        <h1 style={{ fontSize: '26px', fontWeight: 900, color: 'white', margin: '0 0 8px 0', letterSpacing: '-0.5px' }}>Portfolio Manager</h1>
        <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 48px 0' }}>Verificá tu identidad para continuar</p>

        {errorMsg && (
          <div style={{ backgroundColor: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.2)', color: '#ff453a', padding: '12px', borderRadius: '12px', fontSize: '13px', fontWeight: 700, marginBottom: '24px' }}>
            {errorMsg}
          </div>
        )}

        <button
          onClick={handleUnlock}
          disabled={status === 'loading'}
          style={{ width: '100%', padding: '20px', backgroundColor: '#0d6efd', color: 'white', border: 'none', borderRadius: '20px', fontWeight: 900, fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', boxShadow: '0 8px 24px rgba(13,110,253,0.25)', marginBottom: '20px', opacity: status === 'loading' ? 0.7 : 1 }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>
            <path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>
            <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>
            <path d="M2 12a10 10 0 0 1 18-6"/>
            <path d="M2 17.5c.23.91.6 1.76 1.07 2.5"/>
            <path d="M22 12a10 10 0 0 1-.93 4.26"/>
            <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/>
            <path d="M8.65 22c.21-.66.45-1.32.57-2"/>
            <path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>
          </svg>
          {status === 'loading' ? 'Verificando...' : 'Usar Huella / Face ID'}
        </button>

        <button
          onClick={handleSignOut}
          style={{ background: 'none', border: 'none', color: '#6c757d', fontSize: '13px', fontWeight: 700, cursor: 'pointer', padding: '8px' }}
        >
          Cerrar sesión y usar contraseña
        </button>
      </div>
    </div>
  );
}

// ── Modal de activación biométrica ───────────────────────────────────────────
function BiometricSetupModal({ user, onDone }) {
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleActivate = async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      await registerBiometric(user.uid, user.email);
      setStatus('success');
      setTimeout(() => onDone(), 1800);
    } catch (err) {
      setErrorMsg(
        err.name === 'NotAllowedError'
          ? 'Activación cancelada.'
          : err.name === 'InvalidStateError'
          ? 'Ya hay una credencial registrada en este dispositivo.'
          : 'No se pudo activar. Intentá de nuevo.'
      );
      setStatus('error');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ width: '100%', maxWidth: '500px', backgroundColor: '#1a1d21', borderRadius: '32px 32px 0 0', padding: '32px 28px 48px 28px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

        <div style={{ width: '40px', height: '4px', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: '2px', margin: '0 auto 28px auto' }} />

        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ fontSize: '48px', marginBottom: '14px' }}>
            {status === 'success' ? '✅' : '🔐'}
          </div>
          <h2 style={{ fontSize: '22px', fontWeight: 900, color: 'white', margin: '0 0 10px 0' }}>
            {status === 'success' ? '¡Biometría activada!' : 'Activar acceso biométrico'}
          </h2>
          <p style={{ fontSize: '14px', color: '#adb5bd', margin: 0, lineHeight: '1.6' }}>
            {status === 'success'
              ? 'La próxima vez ingresás con huella o Face ID, sin contraseña.'
              : 'Accedé más rápido con huella digital o Face ID, sin necesidad de contraseña.'}
          </p>
        </div>

        {errorMsg && (
          <div style={{ backgroundColor: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.2)', color: '#ff453a', padding: '12px', borderRadius: '12px', fontSize: '13px', fontWeight: 700, marginBottom: '16px', textAlign: 'center' }}>
            {errorMsg}
          </div>
        )}

        {status !== 'success' && (
          <>
            <button
              onClick={handleActivate}
              disabled={status === 'loading'}
              style={{ width: '100%', padding: '18px', backgroundColor: '#0d6efd', color: 'white', border: 'none', borderRadius: '16px', fontWeight: 900, fontSize: '15px', cursor: 'pointer', marginBottom: '12px', opacity: status === 'loading' ? 0.7 : 1 }}
            >
              {status === 'loading' ? 'Registrando...' : 'Activar huella / Face ID'}
            </button>
            <button
              onClick={onDone}
              style={{ width: '100%', padding: '16px', backgroundColor: 'transparent', color: '#6c757d', border: 'none', borderRadius: '16px', fontWeight: 700, fontSize: '15px', cursor: 'pointer' }}
            >
              Ahora no
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── App principal ────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [biometricLocked, setBiometricLocked] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const bioEnabled = isBiometricEnabled();
        const sessionUnlocked = sessionStorage.getItem('bioUnlocked') === 'true';
        const justLoggedIn = sessionStorage.getItem('justLoggedIn') === 'true';

        if (justLoggedIn) {
          sessionStorage.removeItem('justLoggedIn');
          sessionStorage.setItem('bioUnlocked', 'true');
          if (!bioEnabled) {
            const available = await isPlatformAuthenticatorAvailable();
            if (available) setShowSetup(true);
          }
        } else if (bioEnabled && !sessionUnlocked) {
          setBiometricLocked(true);
        }
        setUser(currentUser);
      } else {
        setUser(null);
        setBiometricLocked(false);
        setShowSetup(false);
      }
      setLoadingAuth(false);
    });
    return () => unsubscribe();
  }, []);

  if (loadingAuth) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#111418', color: 'white', fontWeight: 800 }}>
        Verificando seguridad...
      </div>
    );
  }

  if (user && biometricLocked) {
    return (
      <BiometricLockScreen
        onUnlock={() => {
          sessionStorage.setItem('bioUnlocked', 'true');
          setBiometricLocked(false);
        }}
      />
    );
  }

  const RequireAuth = ({ children }) => {
    return user ? children : <Navigate to="/login" replace />;
  };

  return (
    <BrowserRouter>
      {user && showSetup && (
        <BiometricSetupModal user={user} onDone={() => setShowSetup(false)} />
      )}
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/broker/:id" element={<RequireAuth><BrokerDetail /></RequireAuth>} />
        <Route path="/rotaciones" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/evento/:id" element={<RequireAuth><EventDetail /></RequireAuth>} />
        <Route path="/unificada" element={<RequireAuth><Unified /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  );
}
