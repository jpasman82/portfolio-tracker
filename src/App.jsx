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
import Maximos from './pages/Maximos';
import YahooChart from './pages/YahooChart';
import {
  isPlatformAuthenticatorAvailable,
  isBiometricEnabled,
  registerBiometric,
  authenticateWithBiometric,
  isBiometricTrustValid,
  markBiometricTrusted,
  clearBiometric
} from './utils/biometricAuth';

const KICKER = "font-mono text-[12px] tracking-[0.22em] uppercase text-teal-400 flex items-center gap-1.5 mb-1";

function BiometricLockScreen({ onUnlock }) {
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleUnlock = async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      await authenticateWithBiometric();
      markBiometricTrusted();
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
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#080F12] p-5 font-[Space_Grotesk,system-ui,sans-serif] relative overflow-hidden">
      <div className="pointer-events-none absolute top-[-150px] right-[-200px] w-[600px] h-[500px] rounded-full bg-teal-400/[0.04] blur-[100px]" />
      <div className="pointer-events-none absolute bottom-0 left-[-100px] w-[400px] h-[400px] rounded-full bg-teal-400/[0.03] blur-[100px]" />

      <div className="w-full max-w-[360px] text-center relative z-10">
        <div className="w-16 h-16 bg-teal-400/10 border border-teal-400/30 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(45,212,191,0.15)]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2DD4BF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
        </div>

        <p className={`${KICKER} justify-center mb-2`}>
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2DD4BF]" />
          Portfolio Manager
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-[#F0FAFA] mb-2">Acceso bloqueado</h1>
        <p className="font-mono text-[13px] tracking-[0.15em] uppercase text-[#5B8A8A] mb-10">Verificá tu identidad para continuar</p>

        {errorMsg && (
          <div className="bg-red-400/10 border border-red-400/30 text-red-300 px-4 py-3 rounded-xl font-mono text-[13px] tracking-[0.1em] mb-6">
            {errorMsg}
          </div>
        )}

        <button
          onClick={handleUnlock}
          disabled={status === 'loading'}
          className="w-full py-4 bg-teal-400 hover:bg-teal-300 text-[#080F12] font-bold rounded-xl font-mono text-[13px] uppercase tracking-[0.18em] shadow-[0_8px_24px_rgba(45,212,191,0.2)] transition-colors flex items-center justify-center gap-3 mb-4 disabled:opacity-60"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>
            <path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>
            <path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>
          </svg>
          {status === 'loading' ? 'Verificando...' : 'Usar Huella / Face ID'}
        </button>

        <button
          onClick={handleSignOut}
          className="bg-transparent border-none text-[#5B8A8A] hover:text-[#A8C8C8] font-mono text-[12px] tracking-[0.15em] uppercase cursor-pointer py-2 transition-colors"
        >
          Cerrar sesión y usar contraseña
        </button>
      </div>
    </div>
  );
}

function BiometricSetupModal({ user, onDone }) {
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleActivate = async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      await registerBiometric(user.uid, user.email);
      markBiometricTrusted();
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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end justify-center z-[9999]">
      <div className="w-full max-w-[500px] bg-[#122329] border border-teal-400/20 rounded-t-3xl px-7 pb-12 pt-8 font-[Space_Grotesk,system-ui,sans-serif]">
        <div className="w-10 h-1 bg-teal-400/20 rounded-full mx-auto mb-8" />

        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-teal-400/10 border border-teal-400/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
            {status === 'success' ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2DD4BF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2DD4BF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            )}
          </div>
          <h2 className="text-xl font-bold text-[#F0FAFA] mb-2">
            {status === 'success' ? '¡Biometría activada!' : 'Activar acceso biométrico'}
          </h2>
          <p className="text-sm text-[#A8C8C8] leading-relaxed">
            {status === 'success'
              ? 'La próxima vez ingresás con huella o Face ID.'
              : 'Accedé más rápido con huella digital o Face ID, sin contraseña.'}
          </p>
        </div>

        {errorMsg && (
          <div className="bg-red-400/10 border border-red-400/30 text-red-300 px-4 py-3 rounded-xl font-mono text-[13px] tracking-[0.1em] mb-4 text-center">
            {errorMsg}
          </div>
        )}

        {status !== 'success' && (
          <>
            <button
              onClick={handleActivate}
              disabled={status === 'loading'}
              className="w-full py-4 bg-teal-400 hover:bg-teal-300 text-[#080F12] font-bold rounded-xl font-mono text-[13px] uppercase tracking-[0.18em] shadow-[0_8px_24px_rgba(45,212,191,0.2)] transition-colors mb-3 disabled:opacity-60"
            >
              {status === 'loading' ? 'Registrando...' : 'Activar huella / Face ID'}
            </button>
            <button
              onClick={onDone}
              className="w-full py-4 bg-[#0C1518] border border-teal-400/15 hover:border-teal-400/30 text-[#A8C8C8] font-mono text-[12px] uppercase tracking-[0.18em] rounded-xl transition-colors"
            >
              Ahora no
            </button>
          </>
        )}
      </div>
    </div>
  );
}

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
        const trustedDevice = isBiometricTrustValid();
        const justLoggedIn = sessionStorage.getItem('justLoggedIn') === 'true';

        if (justLoggedIn) {
          sessionStorage.removeItem('justLoggedIn');
          sessionStorage.setItem('bioUnlocked', 'true');
          markBiometricTrusted();
          if (!bioEnabled) {
            const available = await isPlatformAuthenticatorAvailable();
            if (available) setShowSetup(true);
          }
        } else if (bioEnabled && !sessionUnlocked && !trustedDevice) {
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
      <div className="flex justify-center items-center h-screen bg-[#080F12]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[#1e3040] border-t-teal-400 rounded-full animate-spin" />
          <p className="font-mono text-[13px] tracking-[0.22em] uppercase text-[#5B8A8A] animate-pulse">
            Verificando seguridad...
          </p>
        </div>
      </div>
    );
  }

  if (user && biometricLocked) {
    return (
      <BiometricLockScreen
        onUnlock={() => {
          sessionStorage.setItem('bioUnlocked', 'true');
          markBiometricTrusted();
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
        <Route path="/maximos" element={<RequireAuth><Maximos /></RequireAuth>} />
        <Route path="/yahoo/:symbol" element={<RequireAuth><YahooChart /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  );
}
