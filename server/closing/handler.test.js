import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./pipeline.js', () => ({ runClose: vi.fn() }));
vi.mock('./legacy.js', () => ({
  getGoogleAccessToken: vi.fn(),
  getServiceAccount: () => ({ projectId: 'test-only' }),
  snapshotDate: () => '2026-09-15',
  isWeekdayInArgentina: () => true,
}));

import captureHandler from '../../api/portfolio-snapshot-capture.js';
import publishHandler from '../../api/portfolio-snapshot-publish.js';
import { authorizeCron } from './http.js';
import { runClose } from './pipeline.js';

const CAPTURE = '/api/portfolio-snapshot-capture';
const PUBLISH = '/api/portfolio-snapshot-publish';
const response = () => ({
  code: null,
  body: null,
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
});
const request = (url, authorization = 'Bearer test-secret') => ({
  method: 'GET',
  url,
  headers: { authorization },
});
const complete = (publicationStatus) => ({
  status: 'COMPLETE',
  stage: publicationStatus === 'PUBLISHED' ? 'PUBLISHED' : 'READY_TO_PUBLISH',
  valid: ['acciones+cedears:GGAL'],
  missing: [],
  archiveStatus: 'NOT_CONFIGURED',
  publicationStatus,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-15T21:10:00Z'));
  vi.stubEnv('CRON_SECRET', 'test-secret');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('PORTFOLIO_CAPTURE_CUTOFF_ART', '18:00');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('production close cron routes', () => {
  it('18:10 route captures durably and can never request publication', async () => {
    runClose.mockResolvedValue(complete('NOT_REQUESTED'));
    const res = response();
    await captureHandler(request(CAPTURE), res);

    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ ok: true, phase: 'capture', publicationStatus: 'NOT_REQUESTED' });
    expect(runClose).toHaveBeenCalledOnce();
    expect(runClose.mock.calls[0][0]).toMatchObject({ date: '2026-09-15', publish: false });
  });

  it('19:35 route reconciles and publishes only a COMPLETE run', async () => {
    vi.setSystemTime(new Date('2026-09-15T22:35:00Z'));
    runClose.mockResolvedValue(complete('PUBLISHED'));
    const res = response();
    await publishHandler(request(PUBLISH), res);

    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ ok: true, phase: 'publish', status: 'COMPLETE', publicationStatus: 'PUBLISHED' });
    expect(runClose.mock.calls[0][0]).toMatchObject({ date: '2026-09-15', publish: true });
  });

  it('publish route exposes PARTIAL as a retryable failure and does not claim success', async () => {
    vi.setSystemTime(new Date('2026-09-15T22:35:00Z'));
    runClose.mockResolvedValue({
      status: 'PARTIAL', stage: 'AWAITING_RETRY', valid: [], missing: ['GGAL'],
      archiveStatus: 'NOT_CONFIGURED', publicationStatus: 'NOT_PUBLISHED',
    });
    const res = response();
    await publishHandler(request(PUBLISH), res);

    expect(res.code).toBe(503);
    expect(res.body).toMatchObject({ ok: false, phase: 'publish', status: 'PARTIAL' });
  });

  it('fails closed before each cutoff while allowing a delayed Vercel invocation', async () => {
    runClose.mockResolvedValue(complete('NOT_REQUESTED'));
    vi.setSystemTime(new Date('2026-09-15T21:09:59Z'));
    const earlyCapture = response();
    await captureHandler(request(CAPTURE), earlyCapture);
    expect(earlyCapture.body.error).toBe('BEFORE_CAPTURE_CUTOFF');

    vi.setSystemTime(new Date('2026-09-15T22:34:59Z'));
    const earlyPublish = response();
    await publishHandler(request(PUBLISH), earlyPublish);
    expect(earlyPublish.body.error).toBe('BEFORE_PUBLISH_CUTOFF');

    vi.setSystemTime(new Date('2026-09-15T23:20:00Z'));
    runClose.mockResolvedValue(complete('PUBLISHED'));
    const delayed = response();
    await publishHandler(request(PUBLISH), delayed);
    expect(delayed.code).toBe(200);
    expect(runClose).toHaveBeenCalledOnce();
  });

  it('requires the exact secret when CRON_SECRET is configured', async () => {
    for (const authorization of [undefined, 'Bearer wrong', 'bearer test-secret']) {
      const req = request(CAPTURE, authorization);
      if (authorization === undefined) delete req.headers.authorization;
      const res = response();
      await captureHandler(req, res);
      expect(res.code).toBe(401);
    }
    expect(runClose).not.toHaveBeenCalled();
  });

  it('secretless fallback is production-only, route-exact, UA-exact, and warns structurally', () => {
    const warning = vi.fn();
    const req = { method: 'GET', url: CAPTURE, headers: { 'user-agent': 'vercel-cron/1.0' } };
    expect(authorizeCron(req, 'capture', { VERCEL_ENV: 'production' }, warning)).toBe(true);
    expect(warning).toHaveBeenCalledWith({
      event: 'cron_auth_fallback', code: 'CRON_SECRET_MISSING', phase: 'capture', route: CAPTURE,
    });
    expect(authorizeCron(req, 'capture', { VERCEL_ENV: 'preview' }, warning)).toBe(false);
    expect(authorizeCron({ ...req, url: `${CAPTURE}?date=2026-09-11` }, 'capture', { VERCEL_ENV: 'production' }, warning)).toBe(true);
    expect(authorizeCron({ ...req, url: '/api/portfolio-snapshot' }, 'capture', { VERCEL_ENV: 'production' }, warning)).toBe(false);
    expect(authorizeCron({ ...req, headers: { 'user-agent': 'vercel-cron/2.0' } }, 'capture', { VERCEL_ENV: 'production' }, warning)).toBe(false);
  });

  it('rejects non-GET requests and ignores request-controlled date or mode', async () => {
    const post = response();
    await captureHandler({ ...request(CAPTURE), method: 'POST' }, post);
    expect(post.code).toBe(405);

    runClose.mockResolvedValue(complete('NOT_REQUESTED'));
    const res = response();
    await captureHandler({ ...request(`${CAPTURE}?date=2026-09-11&mode=publish`),
      query: { date: '2026-09-11', mode: 'publish' } }, res);
    expect(runClose.mock.calls[0][0]).toMatchObject({ date: '2026-09-15', publish: false });
  });
});
