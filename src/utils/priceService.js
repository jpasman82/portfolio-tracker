let cachedPriceMap = {};
let cachedMepRate = null;
let cachedCclRate = null;
let cachedBonds = new Set();

const BASE_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTsH6upQFn5HjXEQOD3Rcr4y_JFzuNCgoIGcxQb9CCPP0huMYV5W4NbdzLwA41JQGO2CvxDDrDbPPZq/pub";

const parsePrice = (val) => {
  if (!val) return 0;
  let clean = val.replace(/\$|US\$|USD/gi, '').trim();
  // Argentine format: 9.340,00 → remove dots, replace comma with dot
  if (clean.includes('.') && clean.includes(',') && clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (clean.includes(',') && !clean.includes('.')) {
    clean = clean.replace(',', '.');
  } else if (clean.includes(',') && clean.includes('.') && clean.lastIndexOf('.') > clean.lastIndexOf(',')) {
    clean = clean.replace(/,/g, '');
  }
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
};

export const fetchAllPrices = async () => {
  try {
    const priceMap = {};
    let mepRate = null;
    let cclRate = null;
    const newBonds = new Set();

    const [lookupText, dolarText] = await Promise.all([
      fetch(`${BASE_URL}?gid=1196344448&single=true&output=tsv`).then(r => r.text()),
      fetch(`${BASE_URL}?gid=810811578&single=true&output=tsv`).then(r => r.text()),
    ]);

    // DOLAR sheet: extract MEP and CCL rates
    dolarText.split(/\r?\n/).forEach(line => {
      const cells = line.split('\t');
      if (cells.length < 2) return;
      const colA = cells[0].trim().toUpperCase();
      const colB = cells[1].trim();
      if (!colA || !colB) return;

      if (colA.includes('MEP')) {
        const v = parsePrice(colB);
        if (v > 0) { mepRate = v; priceMap['MEP'] = v; }
      } else if (colA.includes('CCL') || colA.includes('CABLE')) {
        const v = parsePrice(colB);
        if (v > 0) { cclRate = v; priceMap['CCL'] = v; }
      }
    });

    // PRECIOS_LOOKUP sheet: prices for all instruments
    // Bonds have plain ticker in col A (e.g. "AL30")
    // Stocks/CEDEARs have "* TICKER *" format in col A, price is last token of col B
    lookupText.split(/\r?\n/).forEach(line => {
      const cells = line.split('\t');
      if (cells.length < 2) return;
      const colA_raw = cells[0].trim();
      const colB_raw = cells[1].trim();
      if (!colA_raw || !colB_raw) return;

      let ticker = '';
      let priceStr = '';
      let isBond = false;

      if (colA_raw.includes('*')) {
        const parts = colA_raw.split('*');
        if (parts.length >= 2) ticker = parts[1].trim().toUpperCase();
        // Price is the last space-separated token in colB (after the description)
        const tokens = colB_raw.trim().split(/\s+/);
        priceStr = tokens[tokens.length - 1] || '';
      } else {
        ticker = colA_raw.toUpperCase();
        priceStr = colB_raw;
        isBond = true;
      }

      if (!ticker || ticker === 'TICKER') return;

      const price = parsePrice(priceStr);
      if (price > 0) {
        priceMap[ticker] = price;
        if (isBond) {
          newBonds.add(ticker);
          // Also register the D-suffixed variant with same price
          if (!ticker.endsWith('D')) {
            priceMap[ticker + 'D'] = price;
            newBonds.add(ticker + 'D');
          }
        }
      }
    });

    if (Object.keys(priceMap).length > 0) cachedPriceMap = priceMap;
    if (mepRate > 0) cachedMepRate = mepRate;
    if (cclRate > 0) cachedCclRate = cclRate;
    if (newBonds.size > 0) cachedBonds = newBonds;

    return priceMap;
  } catch (error) {
    throw new Error("No se pudo conectar con tu Google Sheet.");
  }
};

export const getMepRate = () => cachedMepRate;
export const getCclRate = () => cachedCclRate;

export const isBondTicker = (ticker) => {
  if (!ticker) return false;
  return cachedBonds.has(ticker.toUpperCase().trim());
};

export const diagnosticoSheet = async () => {};
