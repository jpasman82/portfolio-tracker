let cachedPriceMap = {};
let cachedMepRate = null;
let cachedBonds = new Set();

export const fetchAllPrices = async () => {
  const baseUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTsH6upQFn5HjXEQOD3Rcr4y_JFzuNCgoIGcxQb9CCPP0huMYV5W4NbdzLwA41JQGO2CvxDDrDbPPZq/pub";

  const sheets = [
    { gid: '0', type: 'CEDEARS' },
    { gid: '717163111', type: 'BONOS' },
    { gid: '761290000', type: 'ACCIONES' },
    { gid: '810811578', type: 'DOLAR' }
  ];

  try {
    const priceMap = {};
    let mepRate = null;
    const newBonds = new Set();

    const parsePrice = (val) => {
      if (!val) return 0;
      let clean = val.replace(/\$|US\$|USD/gi, '').trim();
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

    const fetchPromises = sheets.map(sheet =>
      fetch(`${baseUrl}?gid=${sheet.gid}&single=true&output=tsv`)
        .then(res => res.text())
        .then(text => ({ text, type: sheet.type }))
    );

    const results = await Promise.all(fetchPromises);

    results.forEach(({ text, type }) => {
      const lines = text.split(/\r?\n/);
      lines.forEach(line => {
        const cells = line.split('\t');
        if (cells.length >= 2) {
          const colA_raw = cells[0].trim();
          const colA = colA_raw.toUpperCase();
          const colB = cells[1].trim();

          if (!colA || !colB) return;

          if (colA.includes('MEP')) {
            const parsedMep = parsePrice(colB);
            if (parsedMep > 0) {
              mepRate = parsedMep;
              priceMap['MEP'] = parsedMep;
            }
          } else {
            let ticker = "";
            if (colA_raw.includes('*')) {
              const parts = colA_raw.split('*');
              if (parts.length >= 2) ticker = parts[1].trim().toUpperCase();
            } else {
              ticker = colA;
            }

            if (ticker) {
              const price = parsePrice(colB);
              if (price > 0) {
                priceMap[ticker] = price;
                if (!ticker.endsWith('D')) priceMap[ticker + 'D'] = price;

                if (type === 'BONOS') {
                  newBonds.add(ticker);
                  if (!ticker.endsWith('D')) newBonds.add(ticker + 'D');
                }
              }
            }
          }
        }
      });
    });

    if (Object.keys(priceMap).length > 0) cachedPriceMap = priceMap;
    if (mepRate > 0) cachedMepRate = mepRate;
    if (newBonds.size > 0) cachedBonds = newBonds;

    return priceMap;
  } catch (error) {
    throw new Error("No se pudo conectar con tu Google Sheet.");
  }
};

export const getMepRate = () => cachedMepRate;

export const isBondTicker = (ticker) => {
  if (!ticker) return false;
  return cachedBonds.has(ticker.toUpperCase().trim());
};

export const diagnosticoSheet = async () => {};