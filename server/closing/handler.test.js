import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./morning.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runMorning: vi.fn() };
});
vi.mock('./legacy.js', () => ({
  getGoogleAccessToken: vi.fn(),
  getServiceAccount: () => ({ projectId: 'test-only' }),
  snapshotDate: () => '2026-09-17',
}));

import morningHandler from '../../api/portfolio-snapshot-morning.js';
import { authorizeMorningCron, MORNING_CRON, MORNING_ROUTE } from './morning-http.js';
import { runMorning, VALUATION_SCOPE } from './morning.js';

const vercelConfig = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const response = () => ({
  code: null,
  body: null,
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
});
const request = (url = MORNING_ROUTE, authorization = 'Bearer test-secret') => ({
  method: 'GET',
  url,
  headers: { authorization },
});
const complete = { status: 'COMPLETE', stage: 'PUBLISHED', publicationStatus: 'PUBLISHED',
  informationDate: '2026-09-17', valuationDate: '2026-09-16', prices: 3, brokers: 1, mep: 1000 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-17T13:00:00Z'));
  vi.stubEnv('CRON_SECRET', 'test-secret');
  vi.stubEnv('VERCEL_ENV', 'production');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('morning previous-close production route', () => {
  it.each([
    ['08:00', '2026-09-17T11:00:00Z'],
    ['08:59', '2026-09-17T11:59:59Z'],
    ['09:00', '2026-09-17T12:00:00Z'],
    ['09:59', '2026-09-17T12:59:59Z'],
    ['10:00', '2026-09-17T13:00:00Z'],
    ['10:59', '2026-09-17T13:59:59Z'],
  ])('accepts the full Hobby invocation hour at %s ART', async (_label, timestamp) => {
    vi.setSystemTime(new Date(timestamp));
    runMorning.mockResolvedValue(complete);
    const res = response();
    await morningHandler(request(), res);
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ ok: true, valuationDate: '2026-09-16' });
    expect(runMorning).toHaveBeenCalledWith(expect.objectContaining({ informationDate: '2026-09-17' }));
  });

  it('rejects execution before the 08:00 ART cutoff without reads or writes', async () => {
    vi.setSystemTime(new Date('2026-09-17T10:59:59Z'));
    const res = response();
    await morningHandler(request(), res);
    expect(res.code).toBe(503);
    expect(res.body.error).toBe('BEFORE_MORNING_CUTOFF');
    expect(runMorning).not.toHaveBeenCalled();
  });

  it('allows a delayed same-day invocation because previous_close is not intraday trade', async () => {
    vi.setSystemTime(new Date('2026-09-17T15:00:00Z'));
    runMorning.mockResolvedValue(complete);
    const res = response();
    await morningHandler(request(), res);
    expect(res.code).toBe(200);
  });

  it('configures exactly three weekday retries at 08, 09 and 10 ART on the same route', () => {
    const schedules = ['0 11 * * 1-5', '0 12 * * 1-5', '0 13 * * 1-5'];
    expect(vercelConfig.crons).toEqual(schedules.map((schedule) => ({ path: MORNING_ROUTE, schedule })));
    expect(MORNING_CRON).toEqual({ schedules, startART: '08:00' });
    expect(vercelConfig.crons.every(({ path }) => path === MORNING_ROUTE)).toBe(true);
    expect(vercelConfig.crons.some(({ schedule }) => /\s(?:21|22|23)\s/.test(schedule))).toBe(false);
    expect(Object.keys(vercelConfig.functions)).toEqual(['api/portfolio-snapshot-morning.js']);
  });

  it('keeps valuation scoped exclusively to brokerPositions', () => {
    expect(VALUATION_SCOPE).toEqual({ name: 'BROKERS_ONLY', collection: 'brokerPositions' });
    expect(JSON.stringify(VALUATION_SCOPE)).not.toMatch(/loan|nonBrokerAssets|reclus/i);
  });

  it('requires the exact CRON_SECRET when configured', async () => {
    for (const authorization of [undefined, 'Bearer wrong', 'bearer test-secret']) {
      const req = request(MORNING_ROUTE, authorization);
      if (authorization === undefined) delete req.headers.authorization;
      const res = response();
      await morningHandler(req, res);
      expect(res.code).toBe(401);
    }
    expect(runMorning).not.toHaveBeenCalled();
  });

  it('limits secretless fallback to Production, exact route and exact Vercel UA', () => {
    const warning = vi.fn();
    const req = { method: 'GET', url: MORNING_ROUTE, headers: { 'user-agent': 'vercel-cron/1.0' } };
    expect(authorizeMorningCron(req, { VERCEL_ENV: 'production' }, warning)).toBe(true);
    expect(warning).toHaveBeenCalledWith({ event: 'cron_auth_fallback', code: 'CRON_SECRET_MISSING', route: MORNING_ROUTE });
    expect(authorizeMorningCron(req, { VERCEL_ENV: 'preview' }, warning)).toBe(false);
    expect(authorizeMorningCron({ ...req, url: '/api/portfolio-snapshot-capture' }, { VERCEL_ENV: 'production' }, warning)).toBe(false);
    expect(authorizeMorningCron({ ...req, headers: { 'user-agent': 'vercel-cron/2.0' } }, { VERCEL_ENV: 'production' }, warning)).toBe(false);
  });

  it('rejects non-GET and request-controlled date, mode, force or policy', async () => {
    const post = response();
    await morningHandler({ ...request(), method: 'POST' }, post);
    expect(post.code).toBe(405);
    for (const query of ['date=2026-09-16', 'mode=publish', 'force=true', 'policy=trade']) {
      const res = response();
      await morningHandler(request(`${MORNING_ROUTE}?${query}`), res);
      expect(res.code).toBe(400);
      expect(res.body.error).toBe('REQUEST_PARAMETERS_NOT_ALLOWED');
    }
    expect(runMorning).not.toHaveBeenCalled();
  });

  it('exposes only safe missing-requirement diagnostics for the private route', async () => {
    const missing = [{ requirementKey: 'acciones+cedears:MISS', ticker: 'MISS',
      providerSymbols: ['MISS'], groups: ['acciones', 'cedears'],
      positions: [{ broker: 'one', quantity: 2, localTicker: 'MISS', providerSymbol: 'MISS' }],
      reasons: ['BYMA_ROW_NOT_FOUND'], candidates: [] }];
    runMorning.mockRejectedValue(Object.assign(new Error('MISSING_REQUIRED_PREVIOUS_CLOSE'), {
      code: 'MISSING_REQUIRED_PREVIOUS_CLOSE', details: { missing },
    }));
    const res = response();
    await morningHandler(request(), res);
    expect(res.code).toBe(503);
    expect(res.body).toEqual(expect.objectContaining({ informationDate: '2026-09-17', missing }));
    expect(JSON.stringify(res.body)).not.toMatch(/token|credential|secret|private.key/i);
  });
});
