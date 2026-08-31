// src/utils/numberFormat.js
// Parseo y formateo de importes en formato es-AR, tolerante a la entrada con
// punto decimal (teclado numérico / pegado desde otra app).
//
// El problema que resuelve: la versión anterior borraba TODOS los puntos antes
// de convertir a número, así que "0.48" terminaba siendo 48 (x100). Con precios
// de CEDEARs en USD por debajo de 1 (BIOX) eso se guardaba corrupto en Firestore.

// "1.234", "85.200", "1.500.000" → los puntos son separadores de miles.
// Un cero adelante nunca abre un grupo de miles, así que "0.500" es decimal.
const GROUPED = /^[1-9]\d{0,2}(\.\d{3})+$/;

/**
 * Separa un string en parte entera (solo dígitos) y parte decimal (solo dígitos).
 * Devuelve `dec === null` cuando no hay separador decimal.
 */
function splitAmount(str) {
  const sign = str.trim().startsWith('-') ? '-' : '';
  const clean = str.replace(/[^0-9.,]/g, '');
  if (!clean) return null;

  const commaIdx = clean.indexOf(',');
  if (commaIdx >= 0) {
    // Formato es-AR clásico: punto = miles, coma = decimal.
    return {
      sign,
      int: clean.slice(0, commaIdx).replace(/\./g, ''),
      dec: clean.slice(commaIdx + 1).replace(/[.,]/g, ''),
    };
  }

  if (GROUPED.test(clean)) {
    return { sign, int: clean.replace(/\./g, ''), dec: null };
  }

  const dotIdx = clean.indexOf('.');
  if (dotIdx >= 0) {
    // Un punto que no arma grupos de miles es un separador decimal.
    return {
      sign,
      int: clean.slice(0, dotIdx).replace(/\./g, ''),
      dec: clean.slice(dotIdx + 1).replace(/\./g, ''),
    };
  }

  return { sign, int: clean, dec: null };
}

/**
 * String o número → número. Acepta "1.537,07", "0,48", "0.48", "16.4", "1.500".
 */
export function parseNum(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;

  const parts = splitAmount(val.toString());
  if (!parts) return 0;
  const { sign, int, dec } = parts;
  return Number(`${sign}${int || '0'}${dec ? `.${dec}` : ''}`) || 0;
}

/**
 * Valor de un input de importe, formateado en es-AR mientras se escribe.
 * Conserva la coma final y los decimales tal como se van tipeando.
 */
export function formatInput(val) {
  if (val === undefined || val === null || val === '') return '';
  if (typeof val === 'number') return formatInput(val.toString().replace('.', ','));

  const parts = splitAmount(val.toString());
  if (!parts) return '';
  const { sign, int, dec } = parts;
  // No se agrupa con cero adelante: "0500" no debe mostrarse como "0.500".
  const grouped = int.length > 1 && int.startsWith('0')
    ? int
    : int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec === null ? `${sign}${grouped}` : `${sign}${grouped},${dec}`;
}

/**
 * Normaliza una edición de un caracter contra lo que el input estaba mostrando.
 *
 * Sin esto el punto es ambiguo: en el string mostrado los puntos son
 * separadores de miles, pero el que acaba de tipear el usuario es decimal.
 *
 * @param {string|number} previousRaw  valor en el state antes del cambio
 * @param {string} nextValue           e.target.value
 */
export function normalizeTypedInput(previousRaw, nextValue) {
  const shown = formatInput(previousRaw);
  if (Math.abs(nextValue.length - shown.length) !== 1) return nextValue;
  if (shown.includes(',') || nextValue.includes(',')) return nextValue;

  if (nextValue.length > shown.length) {
    let i = 0;
    while (i < shown.length && shown[i] === nextValue[i]) i++;
    // Punto recién tipeado → es el separador decimal.
    if (nextValue[i] === '.') return `${nextValue.slice(0, i)},${nextValue.slice(i + 1)}`;
  }

  // Alta o borrado de un dígito sobre un número agrupado: los puntos que
  // quedaron eran separadores de miles, se regeneran al reformatear.
  return nextValue.replace(/\./g, '');
}

/** Número fijo de decimales, con coma. */
export function formatDecimals(val, decimals = 2) {
  return parseNum(val).toFixed(decimals).replace('.', ',');
}

/**
 * Precio: hasta 4 decimales (mínimo 2), sin ceros al final.
 * 0,4730 → "0,473"  ·  1537,07 → "1537,07"  ·  727 → "727,00"
 */
export function formatPrice(val) {
  const fixed = parseNum(val).toFixed(4).replace(/0+$/, '');
  const [int, dec = ''] = fixed.split('.');
  return `${int},${dec.padEnd(2, '0')}`;
}
