import { readFileSync } from 'node:fs';
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
import { authorizeCron, CRON_PHASES, PRODUCTION_CAPTURE_POLICY, VALUATION_SCOPE } from './http.js';
import { runClose } from './pipeline.js';

const CAPTURE = '/api/portfolio-snapshot-capture';
const PUBLISH = '/api/portfolio-snapshot-publish';
const vercelConfig = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
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
  vi.setSystemTime(new Date('2026-09-15T21:00:00Z'));
  vi.stubEnv('CRON_SECRET', 'test-secret');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('PORTFOLIO_CAPTURE_CUTOFF_ART', '18:00');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('production close cron routes', () => {
  it.each([
    ['18:00', '2026-09-15T21:00:00Z'],
    ['18:59', '2026-09-15T21:59:59Z'],
  ])('capture at %s ART is accepted and can never request publication', async (_label, timestamp) => {
    vi.setSystemTime(new Date(timestamp));
    runClose.mockResolvedValue(complete('NOT_REQUESTED'));
    const res = response();
    await captureHandler(request(CAPTURE), res);

    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ ok: true, phase: 'capture', publicationStatus: 'NOT_REQUESTED' });
    expect(runClose).toHaveBeenCalledOnce();
    expect(runClose.mock.calls[0][0]).toMatchObject({ date: '2026-09-15', publish: false });
  });

  it('pins the production capture policy to 18:00 despite a later legacy environment value', async () => {
    vi.stubEnv('PORTFOLIO_CAPTURE_CUTOFF_ART', '18:10');
    vi.setSystemTime(new Date('2026-09-15T21:00:00Z'));
    runClose.mockResolvedValue(complete('NOT_REQUESTED'));
    const res = response();
    await captureHandler(request(CAPTURE), res);

    expect(res.code).toBe(200);
    expect(PRODUCTION_CAPTURE_POLICY.cutoffART).toBe('18:00');
    expect(runClose.mock.calls[0][0].policy.cutoffART).toBe('18:00');
  });

  it('capture before 18:00 ART is rejected without invoking the pipeline', async () => {
    vi.setSystemTime(new Date('2026-09-15T20:59:59Z'));
    const res = response();
    await captureHandler(request(CAPTURE), res);

    expect(res.code).toBe(503);
    expect(res.body.error).toBe('BEFORE_CAPTURE_CUTOFF');
    expect(runClose).not.toHaveBeenCalled();
  });

  it.each([
    ['20:00', '2026-09-15T23:00:00Z'],
    ['20:59', '2026-09-15T23:59:59Z'],
  ])('publish at %s ART reconciles and can publish a COMPLETE run', async (_label, timestamp) => {
    vi.setSystemTime(new Date(timestamp));
    runClose.mockResolvedValue(complete('PUBLISHED'));
    const res = response();
    await publishHandler(request(PUBLISH), res);

    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ ok: true, phase: 'publish', status: 'COMPLETE', publicationStatus: 'PUBLISHED' });
    expect(runClose.mock.calls[0][0]).toMatchObject({ date: '2026-09-15', publish: true });
  });

  it('publish before 20:00 ART is rejected without invoking the pipeline', async () => {
    vi.setSystemTime(new Date('2026-09-15T22:59:59Z'));
    const res = response();
    await publishHandler(request(PUBLISH), res);

    expect(res.code).toBe(503);
    expect(res.body.error).toBe('BEFORE_PUBLISH_CUTOFF');
    expect(runClose).not.toHaveBeenCalled();
  });

  it('publish route exposes PARTIAL as a retryable failure and does not claim success', async () => {
    vi.setSystemTime(new Date('2026-09-15T23:00:00Z'));
    runClose.mockResolvedValue({
      status: 'PARTIAL', stage: 'AWAITING_RETRY', valid: [], missing: ['GGAL'],
      archiveStatus: 'NOT_CONFIGURED', publicationStatus: 'NOT_PUBLISHED',
    });
    const res = response();
    await publishHandler(request(PUBLISH), res);

    expect(res.code).toBe(503);
    expect(res.body).toMatchObject({ ok: false, phase: 'publish', status: 'PARTIAL' });
  });

  it('allows a delayed Vercel publish invocation', async () => {
    vi.setSystemTime(new Date('2026-09-16T00:20:00Z'));
    runClose.mockResolvedValue(complete('PUBLISHED'));
    const delayed = response();
    await publishHandler(request(PUBLISH), delayed);
    expect(delayed.code).toBe(200);
    expect(runClose).toHaveBeenCalledOnce();
  });

  it('cron schedules start at their internal cutoffs and retain weekday-only routes', () => {
    const crons = Object.fromEntries(vercelConfig.crons.map((cron) => [cron.path, cron.schedule]));
    expect(crons).toEqual({
      [CAPTURE]: '0 21 * * 1-5',
      [PUBLISH]: '0 23 * * 1-5',
    });
    const utcCronStartAsArt = (schedule) => {
      const [minute, utcHour] = schedule.split(' ');
      return `${String((Number(utcHour) + 21) % 24).padStart(2, '0')}:${minute.padStart(2, '0')}`;
    };
    expect(utcCronStartAsArt(crons[CAPTURE])).toBe(CRON_PHASES.capture.cutoffART);
    expect(utcCronStartAsArt(crons[PUBLISH])).toBe(CRON_PHASES.publish.cutoffART);
  });

  it('keeps historical valuation scoped exclusively to broker positions', () => {
    expect(VALUATION_SCOPE).toEqual({ name: 'BROKERS_ONLY', collection: 'brokerPositions' });
    expect(JSON.stringify(VALUATION_SCOPE)).not.toMatch(/loan|nonBrokerAssets/i);
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
