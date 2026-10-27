import { endpoint } from './model.js';

const BASE = 'https://apigw.byma.com.ar';
export function createBymaClient({ env = process.env, fetchImpl = fetch } = {}) {
  let tokenPromise;
  const error = (code, status) => Object.assign(new Error(code), { code, httpStatus: status || null });
  const token = () => {
    if (!tokenPromise) tokenPromise = (async () => {
      const clientId = env.BYMA_CLIENT_ID || env.VITE_BYMA_CLIENT_ID;
      const secret = env.BYMA_CLIENT_SECRET || env.VITE_BYMA_CLIENT_SECRET;
      if (!clientId || !secret) throw error('BYMA_CREDENTIALS_MISSING');
      const response = await fetchImpl(`${BASE}/oauth/token/`, { method: 'POST',
        signal: AbortSignal.timeout(6_000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId,
          client_secret: secret, scope: 'snapshot.read' }).toString() });
      if (!response.ok) throw error('BYMA_AUTH_FAILED', response.status);
      const body = await response.json();
      if (!body.access_token) throw error('BYMA_TOKEN_MISSING');
      return body.access_token;
    })();
    return tokenPromise;
  };
  return {
    async fetchGroup(group, { fallbackSettlement = null } = {}) {
      const accessToken = await token();
      const fetchSettlement = async (settlement) => {
        const response = await fetchImpl(`${BASE}${endpoint(group, settlement)}`, { signal: AbortSignal.timeout(10_000),
          headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } });
        if (!response.ok) throw error('BYMA_GROUP_FAILED', response.status);
        const body = await response.json();
        if (!Array.isArray(body.result)) throw error('BYMA_INVALID_RESPONSE');
        return body;
      };
      const primary = await fetchSettlement('0002');
      if (!fallbackSettlement) return primary;
      const fallback = await fetchSettlement(fallbackSettlement);
      const primarySymbols = new Set(primary.result.map((row) => String(row?.symbol || '').trim().toUpperCase()));
      return {
        ...primary,
        result: [...primary.result, ...fallback.result.filter((row) =>
          !primarySymbols.has(String(row?.symbol || '').trim().toUpperCase()))],
      };
    },
  };
}
