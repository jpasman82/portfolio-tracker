import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./pipeline.js', () => ({ runClose: vi.fn() }));
vi.mock('./legacy.js', () => ({ default: vi.fn(async (_req, res) => res.status(200).json({ legacy: true })),
  getGoogleAccessToken: vi.fn(), getServiceAccount: () => ({ projectId: 'test-only' }),
  snapshotDate: () => '2026-09-15', isWeekdayInArgentina: () => true,
  encodeFirestoreValue: vi.fn(), decodeFirestoreFields: vi.fn() }));
import handler from '../../api/portfolio-snapshot.js';
import { runClose } from './pipeline.js';
import legacyHandler from './legacy.js';
const response = () => ({ code: null, body: null,
  status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('CRON_SECRET', 'test-secret'); vi.stubEnv('PORTFOLIO_CLOSE_MODE', 'capture'); });
afterEach(() => vi.unstubAllEnvs());
describe('B1 HTTP containment', () => {
  it('missing server secret fails closed without invoking any writer', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = response();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.code).toBe(401);
    expect(runClose).not.toHaveBeenCalled();
    expect(legacyHandler).not.toHaveBeenCalled();
  });
  it('rejects unsupported methods and incorrect auth', async () => {
    for (const req of [{ method: 'HEAD', headers: { authorization: 'Bearer test-secret' } }, { method: 'GET', headers: { authorization: 'Bearer wrong' } }]) {
      const res = response(); await handler(req, res);
      expect([401, 405]).toContain(res.code);
    }
    expect(runClose).not.toHaveBeenCalled();
  });
  it('capture mode does not request publication and does not accept target-date backfill', async () => {
    runClose.mockResolvedValue({ status: 'PARTIAL', stage: 'AWAITING_RETRY', valid: [], missing: ['GGAL'], archiveStatus: 'NOT_CONFIGURED' });
    const res = response();
    await handler({ method: 'GET', headers: { authorization: 'Bearer test-secret' }, query: { date: '2026-09-11', force: 'true' } }, res);
    expect(runClose.mock.calls[0][0]).toMatchObject({ publish: false, date: '2026-09-15' });
    expect(res.code).toBe(503);
    expect(res.body.ok).toBe(false);
  });
  it('B1 failures never invoke legacy fallback', async () => {
    runClose.mockRejectedValue(Object.assign(new Error('Secret provider body'), { code: 'BYMA_GROUP_FAILED' }));
    const res = response();
    await handler({ method: 'POST', headers: { authorization: 'Bearer test-secret' } }, res);
    expect(res.code).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('Secret provider body');
    expect(legacyHandler).not.toHaveBeenCalled();
  });
  it('off disables writes; legacy requires explicit selection', async () => {
    const req = { method: 'GET', headers: { authorization: 'Bearer test-secret' } };
    vi.stubEnv('PORTFOLIO_CLOSE_MODE', 'off');
    await handler(req, response());
    expect(runClose).not.toHaveBeenCalled(); expect(legacyHandler).not.toHaveBeenCalled();
    vi.stubEnv('PORTFOLIO_CLOSE_MODE', 'legacy');
    await handler(req, response());
    expect(legacyHandler).toHaveBeenCalledOnce();
  });
});
