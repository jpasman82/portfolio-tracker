export async function fetchGoogleFinanceQuote(symbol, exchange = 'NASDAQ') {
  const params = new URLSearchParams({ symbol, exchange });
  const res = await fetch(`/api/google-finance?${params.toString()}`);
  if (!res.ok) throw new Error(`[Google Finance] ${res.status} en ${symbol}:${exchange}`);
  return res.json();
}

export async function fetchGoogleFinanceQuotes(items = []) {
  const entries = await Promise.allSettled(
    items.map((item) => fetchGoogleFinanceQuote(item.symbol, item.exchange))
  );

  return entries.reduce((map, result, index) => {
    const key = items[index]?.ticker || items[index]?.symbol;
    if (result.status === 'fulfilled' && key) map[key] = result.value;
    return map;
  }, {});
}
