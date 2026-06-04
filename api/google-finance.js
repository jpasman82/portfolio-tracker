const GOOGLE_FINANCE_BASE = 'https://www.google.com/finance/quote';

function parseMoney(value) {
  if (!value) return null;
  return Number(value.replace(/,/g, ''));
}

function textFromHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractQuote(html, symbol, exchange) {
  const text = textFromHtml(html);
  const marker = `${symbol}:${exchange}`;
  const indexes = [];
  let pos = text.indexOf(marker);

  while (pos !== -1) {
    indexes.push(pos);
    pos = text.indexOf(marker, pos + marker.length);
  }

  for (const index of indexes) {
    const section = text.slice(index, index + 700);
    const priceMatch = section.match(/\$\s*([\d,]+(?:\.\d+)?)/);
    if (!priceMatch) continue;

    const changeMatch = section.match(/([+-]\d+(?:\.\d+)?)%\s*\(([+-]?\d+(?:\.\d+)?)\)/);
    return {
      symbol,
      exchange,
      price: parseMoney(priceMatch[1]),
      currency: 'USD',
      changePercent: changeMatch ? Number(changeMatch[1]) : null,
      source: 'google-finance',
    };
  }

  throw new Error(`No pude extraer precio para ${marker}`);
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const symbol = (url.searchParams.get('symbol') || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
    const exchange = (url.searchParams.get('exchange') || 'NASDAQ').toUpperCase().replace(/[^A-Z]/g, '');

    if (!symbol) {
      res.status(400).json({ error: 'Falta symbol' });
      return;
    }

    const upstream = await fetch(`${GOOGLE_FINANCE_BASE}/${encodeURIComponent(`${symbol}:${exchange}`)}`, {
      headers: {
        Accept: 'text/html',
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `Google Finance ${upstream.status}` });
      return;
    }

    const html = await upstream.text();
    const quote = extractQuote(html, symbol, exchange);

    res.status(200)
      .setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
      .json(quote);
  } catch (err) {
    console.error('[google-finance]', err);
    res.status(500).json({ error: err.message });
  }
}
