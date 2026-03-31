import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import NewRotation from './pages/NewRotation';
import EventDetail from './pages/EventDetail';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/rotaciones" element={<Dashboard />} />
        <Route path="/nuevo" element={<NewRotation />} />
        <Route path="/evento/:id" element={<EventDetail />} />
      </Routes>
    </Router>
  );
}

export default App;
