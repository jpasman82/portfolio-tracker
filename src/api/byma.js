// api/byma.js  —  Vercel Serverless Function
// En producción (Vercel) no existe el proxy de Vite.
// Esta función recibe /api/byma/* y lo redirige a apigw.byma.com.ar,
// manteniendo el client_secret en el servidor (nunca llega al browser).
//
// Variables requeridas en Vercel Dashboard (Settings → Environment Variables):
//   BYMA_CLIENT_ID
//   BYMA_CLIENT_SECRET

const BYMA_BASE = 'https://apigw.byma.com.ar';

// Cache liviano: vive mientras la función esté caliente (~5 min en Vercel Free)
let _cache = { token: null, expiresAt: 0 };

async function getToken() {
  const now = Date.now();
  if (_cache.token && now < _cache.expiresAt - 60_000) return _cache.token;

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     process.env.BYMA_CLIENT_ID,
    client_secret: process.env.BYMA_CLIENT_SECRET,
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
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return _cache.token;
}

export default async function handler(req, res) {
  try {
    // Extraer el path aguas arriba quitando el prefijo /api/byma
    // Ej: /api/byma/snapshot/v1/equity?group=ACCIONES → /snapshot/v1/equity?group=ACCIONES
    const upstreamPath = req.url.replace(/^\/api\/byma/, '') || '/';

    const token = await getToken();

    const upstream = await fetch(`${BYMA_BASE}${upstreamPath}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept:        'application/json',
      },
    });

    const body = await upstream.text();

    res.status(upstream.status)
       .setHeader('Content-Type', 'application/json')
       .setHeader('Cache-Control', 'no-store')
       .end(body);

  } catch (err) {
    console.error('[byma/handler]', err);
    res.status(500).json({ error: err.message });
  }
}
