import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase/config';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import BrokerDetail from './pages/BrokerDetail';
import EventDetail from './pages/EventDetail';
import Login from './pages/Login';
import Unified from './pages/Unified';

export default function App() {
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
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

  const RequireAuth = ({ children }) => {
    return user ? children : <Navigate to="/login" replace />;
  };

  return (
    <BrowserRouter>
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