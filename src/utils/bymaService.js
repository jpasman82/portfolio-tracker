// src/utils/bymaService.js
// Usa /api/byma?_path=... para que el token de BYMA quede siempre del lado servidor.

/**
 * GET autenticado a cualquier endpoint de BYMA.
 * @param {string} path  Ej: "/snapshot/v1/equity?group=ACCIONES&..."
 */
export async function bymaGet(path) {
  // Convertir /snapshot/v1/equity?group=X en ?_path=snapshot/v1/equity&group=X
  const [pathOnly, qs] = path.replace(/^\//, '').split('?');
  const params = new URLSearchParams(qs);
  params.set('_path', pathOnly);
  const res = await fetch(`/api/byma?${params.toString()}`);
  if (!res.ok) throw new Error(`[BYMA] ${res.status} en ${path}`);
  return res.json();
}
