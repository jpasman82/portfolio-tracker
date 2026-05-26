// src/utils/bymaService.js
// En DEV:  usa el proxy de Vite → /api/byma/* → apigw.byma.com.ar
// En PROD: usa /api/byma?_path=... → Vercel serverless function

const IS_DEV = import.meta.env.DEV;

const TOKEN_PATH = 'oauth/token/';

let _cache = { token: null, expiresAt: 0 };

export async function getBymaToken() {
  const now = Date.now();
  if (_cache.token && now < _cache.expiresAt - 60_000) return _cache.token;

  let res;

  if (IS_DEV) {
    // Desarrollo: proxy de Vite, mandamos credenciales directamente
    res = await fetch('/api/byma/oauth/token/', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     import.meta.env.VITE_BYMA_CLIENT_ID,
        client_secret: import.meta.env.VITE_BYMA_CLIENT_SECRET,
        scope:         'snapshot.read',
      }).toString(),
    });
  } else {
    // Producción: Vercel function maneja las credenciales
    res = await fetch(`/api/byma?_path=${TOKEN_PATH}`, { method: 'POST' });
  }

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`[BYMA auth] ${res.status}: ${txt}`);
  }

  const data = await res.json();
  _cache = {
    token:     data.access_token,
    expiresAt: now + (data.expires_in ?? 86400) * 1000,
  };
  return _cache.token;
}

/**
 * GET autenticado a cualquier endpoint de BYMA.
 * @param {string} path  Ej: "/snapshot/v1/equity?group=ACCIONES&..."
 */
export async function bymaGet(path) {
  if (IS_DEV) {
    // Desarrollo: proxy de Vite con Bearer token
    const token = await getBymaToken();
    const res = await fetch(`/api/byma${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`[BYMA] ${res.status} en ${path}`);
    return res.json();
  } else {
    // Producción: Vercel function, sin token en el cliente
    // Convertir /snapshot/v1/equity?group=X en ?_path=snapshot/v1/equity&group=X
    const [pathOnly, qs] = path.replace(/^\//, '').split('?');
    const params = new URLSearchParams(qs);
    params.set('_path', pathOnly);
    const res = await fetch(`/api/byma?${params.toString()}`);
    if (!res.ok) throw new Error(`[BYMA] ${res.status} en ${path}`);
    return res.json();
  }
}
