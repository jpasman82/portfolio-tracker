import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './Home';
import Dashboard from './Dashboard';
import EventDetail from './EventDetail';
import NewRotation from './NewRotation';
import BrokerDetail from './BrokerDetail';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/rotaciones" element={<Dashboard />} />
        <Route path="/nuevo" element={<NewRotation />} />
        <Route path="/evento/:id" element={<EventDetail />} />
        <Route path="/broker/:id" element={<BrokerDetail />} />
      </Routes>
    </Router>
  );
}

export default App;
