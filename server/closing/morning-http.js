import { getGoogleAccessToken, getServiceAccount, snapshotDate } from './legacy.js';
import { createBymaClient } from './byma.js';
import { CALENDAR_STATES, classifyBymaDate } from './calendar.js';
import { runMorning, VALUATION_SCOPE } from './morning.js';
import { createRestStore, publicError } from './repository.js';

export const MORNING_ROUTE = '/api/portfolio-snapshot-morning';
export const MORNING_CRON = Object.freeze({ schedule: '0 13 * * 1-5', startART: '10:00' });

const header = (req, name) => req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
const requestUrl = (req) => {
  try { return new URL(req.url, 'https://portfolio-tracker.invalid'); }
  catch { return null; }
};

export function authorizeMorningCron(req, env = process.env,
  warn = (entry) => console.warn(JSON.stringify(entry))) {
  if (requestUrl(req)?.pathname !== MORNING_ROUTE) return false;
  if (env.CRON_SECRET) return header(req, 'authorization') === `Bearer ${env.CRON_SECRET}`;
  const fallback = env.VERCEL_ENV === 'production' && header(req, 'user-agent') === 'vercel-cron/1.0';
  if (fallback) warn({ event: 'cron_auth_fallback', code: 'CRON_SECRET_MISSING', route: MORNING_ROUTE });
  return fallback;
}

export function morningWindowReason(capturedAt) {
  if (typeof capturedAt !== 'string' || !Number.isFinite(Date.parse(capturedAt))) return 'INVALID_CAPTURE_TIME';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(capturedAt)).map((part) => [part.type, part.value]));
  // The cron starts exactly at the internal cutoff. Delayed same-day execution
  // remains safe because BYMA previous_close is the reference price, not trade.
  return `${parts.hour}:${parts.minute}` < MORNING_CRON.startART ? 'BEFORE_MORNING_CUTOFF' : null;
}

export async function handleMorning(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!authorizeMorningCron(req)) return res.status(401).json({ error: 'Unauthorized' });
  const url = requestUrl(req);
  const forbidden = ['date', 'mode', 'force', 'policy'].filter((name) => url.searchParams.has(name));
  if (forbidden.length) return res.status(400).json({ error: 'REQUEST_PARAMETERS_NOT_ALLOWED', forbidden });

  const capturedAt = new Date().toISOString();
  const informationDate = snapshotDate(new Date(capturedAt));
  const windowReason = morningWindowReason(capturedAt);
  if (windowReason) return res.status(503).json({ ok: false, informationDate, error: windowReason });
  const classification = classifyBymaDate(informationDate);
  if (classification.state === 'UNKNOWN') {
    return res.status(503).json({ ok: false, informationDate, error: 'CALENDAR_UNKNOWN' });
  }
  if (classification.state === CALENDAR_STATES.CLOSED) {
    return res.status(200).json({ ok: true, skipped: true, informationDate, reason: 'MARKET_CLOSED' });
  }

  try {
    const store = createRestStore({ projectId: getServiceAccount().projectId, getToken: getGoogleAccessToken });
    const state = await runMorning({
      informationDate,
      store,
      byma: createBymaClient(),
      loadPositions: () => store.list(VALUATION_SCOPE.collection),
      now: () => capturedAt,
    });
    return res.status(200).json({ ok: true, ...state });
  } catch (error) {
    const status = error.code === 'EXISTING_SNAPSHOT_CONFLICT' ? 409 : 503;
    return res.status(status).json({ ok: false, informationDate,
      error: publicError(error, 'MORNING_PREVIOUS_CLOSE', null) });
  }
}
