import { NavLink } from 'react-router-dom';
import './AppBottomNav.css';

const NAV_ITEMS = Object.freeze([
  { id: 'brokers', label: 'Brokers', to: '/', end: true },
  { id: 'portfolio', label: 'Cartera', to: '/unificada' },
  { id: 'assets', label: 'Activos', to: '/activos' },
  { id: 'prices', label: 'Precios', to: '/precios' },
  { id: 'highs', label: 'Máximos', to: '/maximos' },
  { id: 'strategies', label: 'Estrategias', to: '/rotaciones' },
]);

function NavIcon({ id }) {
  const common = {
    width: 21,
    height: 21,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  if (id === 'brokers') {
    return <svg {...common}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>;
  }
  if (id === 'portfolio') {
    return <svg {...common}><path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></svg>;
  }
  if (id === 'assets') {
    return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h10M7 13h6" /><circle cx="17" cy="14" r="1" /></svg>;
  }
  if (id === 'prices') {
    return <svg {...common}><path d="M4 19V5M4 19h16M8 15l3-3 3 2 5-7" /></svg>;
  }
  if (id === 'highs') {
    return <svg {...common}><path d="M3 17l6-6 4 4 8-8M14 7h7v7" /></svg>;
  }
  return <svg {...common}><rect x="18" y="3" width="4" height="18" /><rect x="10" y="8" width="4" height="13" /><rect x="2" y="13" width="4" height="8" /></svg>;
}

export default function AppBottomNav({ hidden = false }) {
  return (
    <nav className={`app-bottom-nav${hidden ? ' is-hidden' : ''}`} aria-label="Navegación principal">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.id}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `app-bottom-nav__item${isActive ? ' is-active' : ''}`}
        >
          <NavIcon id={item.id} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
