import legacyHandler, { getGoogleAccessToken, getServiceAccount, snapshotDate, isWeekdayInArgentina } from '../server/closing/legacy.js';
import { createRestStore, createRepository, publicError } from '../server/closing/repository.js';
import { createBymaClient } from '../server/closing/byma.js';
import { runClose } from '../server/closing/pipeline.js';

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const mode = process.env.PORTFOLIO_CLOSE_MODE || 'capture';
  if (mode === 'off') return res.status(200).json({ skipped: true, reason: 'DISABLED' });
  if (mode === 'legacy') return legacyHandler(req, res); // Explicit rollback only.
  if (!['capture', 'publish'].includes(mode)) return res.status(503).json({ error: 'INVALID_CLOSE_MODE' });
  if (!isWeekdayInArgentina()) return res.status(200).json({ skipped: true, reason: 'WEEKEND' });
  // No arbitrary date/force/backfill capability in B1.
  const date = snapshotDate();
  try {
    const store = createRestStore({ projectId: getServiceAccount().projectId, getToken: getGoogleAccessToken });
    const state = await runClose({ date, repo: createRepository(store), byma: createBymaClient(),
      loadPositions: () => store.list('brokerPositions'), publish: mode === 'publish' });
    return res.status(state.status === 'COMPLETE' ? 200 : 503).json({
      ok: state.status === 'COMPLETE', date, status: state.status, stage: state.stage,
      valid: state.valid.length, missing: state.missing, archiveStatus: state.archiveStatus,
      publicationStatus: state.publicationStatus,
    });
  } catch (error) {
    return res.status(error.code === 'LEASE_BUSY' ? 409 : 503).json({ date, error: publicError(error, 'HANDLER', null) });
  }
}
