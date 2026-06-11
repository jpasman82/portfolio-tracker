const APERTURA_MINUTOS = 10 * 60 + 30;
const CIERRE_MINUTOS = 17 * 60;
const MINUTOS_CERCA_DEL_CIERRE = 15;

export function esMercadoAbierto(date = new Date()) {
  const dia = date.getDay();
  const minutos = date.getHours() * 60 + date.getMinutes();
  return dia >= 1 && dia <= 5 && minutos >= APERTURA_MINUTOS && minutos < CIERRE_MINUTOS;
}

export function esDiaHabil(date = new Date()) {
  const dia = date.getDay();
  return dia >= 1 && dia <= 5;
}

export function esDespuesDelCierre(date = new Date()) {
  const minutos = date.getHours() * 60 + date.getMinutes();
  return esDiaHabil(date) && minutos >= CIERRE_MINUTOS;
}

export function cierreDelDia(date = new Date()) {
  const cierre = new Date(date);
  cierre.setHours(17, 0, 0, 0);
  return cierre;
}

export function fechaMercadoKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function actualizacionCercaDelCierre(lastUpdated, date = new Date()) {
  if (!lastUpdated) return false;
  const timestamp = lastUpdated instanceof Date ? lastUpdated.getTime() : new Date(lastUpdated).getTime();
  if (!Number.isFinite(timestamp)) return false;

  const inicioVentanaCierre = cierreDelDia(date).getTime() - MINUTOS_CERCA_DEL_CIERRE * 60 * 1000;
  return timestamp >= inicioVentanaCierre;
}
