export default async function handler(req, res) {
  const { endpoint } = req.query;
  
  if (!['equities', 'cedears', 'bonds'].includes(endpoint)) {
    return res.status(400).json({ error: 'Endpoint inválido' });
  }

  const targetUrl = `https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free/${endpoint}`;

  try {
    const fetchRes = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // El disfraz de seguridad para producción:
        'Origin': 'https://open.bymadata.com.ar',
        'Referer': 'https://open.bymadata.com.ar/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      body: JSON.stringify({
        "excludeZeroPxAndQty": true,
        "T2": true,
        "T1": false,
        "T0": false
      })
    });

    if (!fetchRes.ok) {
      return res.status(fetchRes.status).json({ error: `BYMA respondió con error ${fetchRes.status}` });
    }

    const data = await fetchRes.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
