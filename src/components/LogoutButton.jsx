import { signOut } from 'firebase/auth';
import { auth } from '../firebase/config';
import './AppBottomNav.css';

async function signOutCurrentUser() {
  sessionStorage.removeItem('bioUnlocked');
  await signOut(auth);
}

export default function LogoutButton() {
  return (
    <button
      type="button"
      onClick={signOutCurrentUser}
      className="app-logout-button"
      aria-label="Cerrar sesión"
      title="Cerrar sesión"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      <span>Salir</span>
    </button>
  );
}
