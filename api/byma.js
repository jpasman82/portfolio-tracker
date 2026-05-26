// api/byma.js — Vercel Serverless Function
// Recibe TODAS las llamadas a BYMA via query param ?_path=
//
// Ejemplos:
//   POST /api/byma?_path=oauth/token/         → token
//   GET  /api/byma?_path=snapshot/v1/equity   → precios

const BYMA_BASE = 'https://apigw.byma.com.ar';

let _cache = { token: null, expiresAt: 0 };

async function getToken() {
  const now = Date.now();
  if (_cache.token && now < _cache.expiresAt - 60_000) return _cache.token;

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     process.env.BYMA_CLIENT_ID,
    client_secret: process.env.BYMA_CLIENT_SECRET,
    scope:         'snapshot.read',
  });

  const res = await fetch(`${BYMA_BASE}/oauth/token/`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!res.ok) throw new Error(`Token ${res.status}: ${await res.text()}`);

  const data = await res.json();
  _cache = {
    token:     data.access_token,
    expiresAt: now + (data.expires_in ?? 86400) * 1000,
  };
  return _cache.token;
}

export default async function handler(req, res) {
  try {
    // Extraer path desde query param ?_path=
    const url    = new URL(req.url, 'http://localhost');
    const path   = url.searchParams.get('_path') || '';
    url.searchParams.delete('_path');
    const qs     = url.searchParams.toString();
    const upstreamPath = '/' + path + (qs ? '?' + qs : '');

    let upstreamRes;

    if (path.startsWith('oauth/token')) {
      // Token: lo resolvemos con las env vars del servidor
      const body = new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     process.env.BYMA_CLIENT_ID,
        client_secret: process.env.BYMA_CLIENT_SECRET,
        scope:         'snapshot.read',
      });
      upstreamRes = await fetch(`${BYMA_BASE}/oauth/token/`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    body.toString(),
      });
      if (upstreamRes.ok) {
        const data = await upstreamRes.clone().json();
        _cache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 86400) * 1000 };
      }
    } else {
      // Datos: autenticamos con token cacheado
      const token = await getToken();
      upstreamRes = await fetch(`${BYMA_BASE}${upstreamPath}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
    }

    const body = await upstreamRes.text();
    if (!upstreamRes.ok) {
      console.error(`[byma] upstream ${upstreamRes.status} en ${upstreamPath}:`, body);
    }
    res.status(upstreamRes.status)
       .setHeader('Content-Type', 'application/json')
       .setHeader('Cache-Control', 'no-store')
       .end(body);

  } catch (err) {
    console.error('[byma]', err);
    res.status(500).json({ error: err.message });
  }
}
