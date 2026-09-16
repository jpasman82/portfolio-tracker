import { getGoogleAccessToken, getServiceAccount, snapshotDate, isWeekdayInArgentina } from './legacy.js';
import { createRestStore, createRepository, publicError } from './repository.js';
import { createBymaClient } from './byma.js';
import { runClose } from './pipeline.js';
import { TIMEZONE, capturePolicy, captureWindowReason } from './model.js';

export const CRON_PHASES = Object.freeze({
  capture: Object.freeze({ route: '/api/portfolio-snapshot-capture', cutoffART: '18:10', publish: false }),
  publish: Object.freeze({ route: '/api/portfolio-snapshot-publish', cutoffART: '19:35', publish: true }),
});

const header = (req, name) => req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
const requestPath = (req) => {
  try { return new URL(req.url, 'https://portfolio-tracker.invalid').pathname; }
  catch { return null; }
};

export function authorizeCron(req, phase, env = process.env,
  warn = (entry) => console.warn(JSON.stringify(entry))) {
  const config = CRON_PHASES[phase];
  if (!config || requestPath(req) !== config.route) return false;
  if (env.CRON_SECRET) return header(req, 'authorization') === `Bearer ${env.CRON_SECRET}`;
  const fallback = env.VERCEL_ENV === 'production' && header(req, 'user-agent') === 'vercel-cron/1.0';
  if (fallback) warn({ event: 'cron_auth_fallback', code: 'CRON_SECRET_MISSING', phase, route: config.route });
  return fallback;
}

export function phaseWindowReason(phase, date, capturedAt, policy) {
  const commonReason = captureWindowReason(date, capturedAt, policy);
  if (commonReason) return commonReason;
  const config = CRON_PHASES[phase];
  if (!config) return 'INVALID_CRON_PHASE';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE,
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(capturedAt)).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}` < config.cutoffART ? `BEFORE_${phase.toUpperCase()}_CUTOFF` : null;
}

export async function handleClose(req, res, phase) {
  const config = CRON_PHASES[phase];
  if (!config) return res.status(404).json({ error: 'Not found' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!authorizeCron(req, phase)) return res.status(401).json({ error: 'Unauthorized' });
  if (!isWeekdayInArgentina()) return res.status(200).json({ skipped: true, reason: 'WEEKEND' });

  const date = snapshotDate();
  try {
    const policy = capturePolicy();
    const windowReason = phaseWindowReason(phase, date, new Date().toISOString(), policy);
    if (windowReason) return res.status(503).json({ ok: false, date, phase, error: windowReason });
    const store = createRestStore({ projectId: getServiceAccount().projectId, getToken: getGoogleAccessToken });
    const state = await runClose({ date, repo: createRepository(store), byma: createBymaClient(),
      loadPositions: () => store.list('brokerPositions'), publish: config.publish, policy });
    return res.status(state.status === 'COMPLETE' ? 200 : 503).json({
      ok: state.status === 'COMPLETE', date, phase, status: state.status, stage: state.stage,
      valid: state.valid.length, missing: state.missing, archiveStatus: state.archiveStatus,
      publicationStatus: state.publicationStatus,
    });
  } catch (error) {
    return res.status(error.code === 'LEASE_BUSY' ? 409 : 503)
      .json({ date, phase, error: publicError(error, phase.toUpperCase(), null) });
  }
}
