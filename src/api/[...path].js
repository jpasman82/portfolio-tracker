// api/byma/[...path].js — Vercel catch-all serverless function
// Captura CUALQUIER ruta bajo /api/byma/* y la proxea a apigw.byma.com.ar
//
// Ejemplos:
//   /api/byma/oauth/token/              → POST apigw.byma.com.ar/oauth/token/
//   /api/byma/snapshot/v1/equity?...    → GET  apigw.byma.com.ar/snapshot/v1/equity?...

const BYMA_BASE = 'https://apigw.byma.com.ar';

// Cache liviano del token (vive mientras la función esté caliente)
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

  if (!res.ok) throw new Error(`Token error ${res.status}: ${await res.text()}`);

  const data = await res.json();
  _cache = {
    token:     data.access_token,
    expiresAt: now + (data.expires_in ?? 86400) * 1000,
  };
  return _cache.token;
}

export default async function handler(req, res) {
  try {
    // req.url es algo como /api/byma/oauth/token/ o /api/byma/snapshot/v1/equity?group=...
    // Quitamos /api/byma para obtener el path de BYMA
    const upstreamPath = req.url.replace(/^\/api\/byma/, '') || '/';

    let upstreamRes;

    if (upstreamPath.startsWith('/oauth/token')) {
      // Pedido de token: lo resolvemos nosotros con las env vars del servidor
      // El cliente NO necesita mandar credenciales, las ponemos acá
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

      // Actualizar cache si fue exitoso
      if (upstreamRes.ok) {
        const data = await upstreamRes.clone().json();
        _cache = {
          token:     data.access_token,
          expiresAt: Date.now() + (data.expires_in ?? 86400) * 1000,
        };
      }
    } else {
      // Pedido de datos: autenticamos con token cacheado
      const token = await getToken();
      upstreamRes = await fetch(`${BYMA_BASE}${upstreamPath}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept:        'application/json',
        },
      });
    }

    const body = await upstreamRes.text();
    res.status(upstreamRes.status)
       .setHeader('Content-Type', 'application/json')
       .setHeader('Cache-Control', 'no-store')
       .end(body);

  } catch (err) {
    console.error('[byma handler]', err);
    res.status(500).json({ error: err.message });
  }
}
