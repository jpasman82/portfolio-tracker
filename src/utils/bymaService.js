// src/utils/bymaService.js
const TOKEN_URL = '/api/byma/oauth/token/';

let _cache = { token: null, expiresAt: 0 };

export async function getBymaToken() {
  console.log('CLIENT_ID:', import.meta.env.VITE_BYMA_CLIENT_ID);
  const now = Date.now();
  if (_cache.token && now < _cache.expiresAt - 60_000) return _cache.token;

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     import.meta.env.VITE_BYMA_CLIENT_ID,
    client_secret: import.meta.env.VITE_BYMA_CLIENT_SECRET,
    scope:         'snapshot.read',   // ← era el parámetro que faltaba
  });

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`[BYMA auth] ${res.status}: ${txt}`);
  }

  const data = await res.json();
  _cache = {
    token:     data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };

  return _cache.token;
}

export async function bymaGet(path) {
  const token = await getBymaToken();
  const res = await fetch(`/api/byma${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`[BYMA] ${res.status} en ${path}`);
  return res.json();
}
