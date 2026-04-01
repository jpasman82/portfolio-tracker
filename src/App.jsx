import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import EventDetail from './pages/EventDetail';
import NewRotation from './pages/NewRotation';
import BrokerDetail from './pages/BrokerDetail';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/rotaciones" element={<Dashboard />} />
        <Route path="/nuevo" element={<NewRotation />} />
        <Route path="/evento/:id" element={<EventDetail />} />
        <Route path="/broker/:id" element={<BrokerDetail />} />
        <Route path="/unificada" element={<Unified />} />
      </Routes>
    </Router>
  );
}

export default App;
