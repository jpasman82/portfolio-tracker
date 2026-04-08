import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import BrokerDetail from './pages/BrokerDetail';
import EventDetail from './pages/EventDetail';
import Unified from './pages/Unified';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/broker/:id" element={<BrokerDetail />} />
        <Route path="/rotaciones" element={<Dashboard />} />
        <Route path="/evento/:id" element={<EventDetail />} />
        <Route path="/unificada" element={<Unified />} />
      </Routes>
    </BrowserRouter>
  );
}
