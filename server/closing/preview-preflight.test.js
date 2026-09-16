import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';

const ENV_NAMES = [
  'VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF', 'VERCEL_GIT_REPO_OWNER', 'VERCEL_GIT_REPO_SLUG',
  'FIREBASE_SERVICE_ACCOUNT_KEY', 'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY',
  'BYMA_CLIENT_ID', 'BYMA_CLIENT_SECRET', 'VITE_BYMA_CLIENT_ID', 'VITE_BYMA_CLIENT_SECRET',
  'CRON_SECRET', 'PORTFOLIO_CLOSE_MODE', 'PORTFOLIO_CAPTURE_CUTOFF_ART',
];

const baseEnv = () => ({
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'codex/b1-durable-close-capture',
  VERCEL_GIT_REPO_OWNER: 'jpasman82',
  VERCEL_GIT_REPO_SLUG: 'portfolio-tracker',
  FIREBASE_PROJECT_ID: 'project-for-test',
  FIREBASE_CLIENT_EMAIL: 'service-account-for-test',
  FIREBASE_PRIVATE_KEY: 'private-key-for-test',
  BYMA_CLIENT_ID: 'client-for-test',
  BYMA_CLIENT_SECRET: 'secret-for-test',
  CRON_SECRET: 'cron-for-test',
  PORTFOLIO_CLOSE_MODE: 'capture',
  PORTFOLIO_CAPTURE_CUTOFF_ART: '18:00',
});

const response = () => ({
  code: null,
  body: null,
  headers: {},
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
  end() { return this; },
  setHeader(name, value) { this.headers[name] = value; },
});

const invoke = async (env = baseEnv(), method = 'GET') => {
  for (const name of ENV_NAMES) vi.stubEnv(name, env[name] ?? '');
  const { default: handler } = await import('../../api/b1-preview-preflight.js');
  const res = response();
  await handler({ method }, res);
  return res;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('B1 preview environment preflight', () => {
  it('returns 404 outside Preview', async () => {
    const res = await invoke({ ...baseEnv(), VERCEL_ENV: 'production' });
    expect(res.code).toBe(404); expect(res.body).toBeNull();
  });

  it('returns 404 for another Preview branch', async () => {
    const res = await invoke({ ...baseEnv(), VERCEL_GIT_COMMIT_REF: 'feature/other' });
    expect(res.code).toBe(404); expect(res.body).toBeNull();
  });

  it('returns 404 for mismatched repository metadata when it is available', async () => {
    const res = await invoke({ ...baseEnv(), VERCEL_GIT_REPO_OWNER: 'another-owner' });
    expect(res.code).toBe(404); expect(res.body).toBeNull();
  });

  it('reports READY for complete B1 Preview configuration', async () => {
    const res = await invoke();
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ ok: true, environment: 'preview', branchOk: true,
      repositoryOk: true, canaryPrerequisites: 'READY',
      firebaseAdmin: { configured: true, strategy: 'SPLIT_FIELDS' },
      byma: { configured: true, source: 'SERVER_NAMES' },
      cronSecret: { configured: true }, closeMode: { explicit: true, safeForCapture: true },
      cutoff: { configured: true, valid: true, safe: true } });
  });

  it('accepts only a structurally complete service-account JSON strategy', async () => {
    const complete = JSON.stringify({ client_email: 'service-account-for-test', private_key: 'private-key-for-test' });
    const configured = await invoke({ ...baseEnv(), FIREBASE_PROJECT_ID: '', FIREBASE_CLIENT_EMAIL: '',
      FIREBASE_PRIVATE_KEY: '', FIREBASE_SERVICE_ACCOUNT_KEY: complete });
    expect(configured.body.firebaseAdmin).toEqual({ configured: true, strategy: 'SERVICE_ACCOUNT_JSON' });
    const incomplete = await invoke({ ...baseEnv(), FIREBASE_SERVICE_ACCOUNT_KEY: '{bad-json' });
    expect(incomplete.body.firebaseAdmin).toEqual({ configured: false, strategy: 'NONE' });
    expect(incomplete.body.canaryPrerequisites).toBe('NOT_READY');
  });

  it('reports incomplete BYMA pairs as NOT_READY', async () => {
    const res = await invoke({ ...baseEnv(), BYMA_CLIENT_SECRET: '' });
    expect(res.body.byma).toEqual({ configured: false, source: 'NONE' });
    expect(res.body.canaryPrerequisites).toBe('NOT_READY');
  });

  it('supports the complete legacy BYMA pair without exposing its values', async () => {
    const res = await invoke({ ...baseEnv(), BYMA_CLIENT_ID: '', BYMA_CLIENT_SECRET: '',
      VITE_BYMA_CLIENT_ID: 'legacy-client-for-test', VITE_BYMA_CLIENT_SECRET: 'legacy-secret-for-test' });
    expect(res.body.byma).toEqual({ configured: true, source: 'LEGACY_NAMES' });
  });

  it('rejects a mixed BYMA configuration when server names are only partial', async () => {
    const res = await invoke({ ...baseEnv(), BYMA_CLIENT_SECRET: '',
      VITE_BYMA_CLIENT_ID: 'legacy-client-for-test', VITE_BYMA_CLIENT_SECRET: 'legacy-secret-for-test' });
    expect(res.body.byma).toEqual({ configured: false, source: 'NONE' });
    expect(res.body.canaryPrerequisites).toBe('NOT_READY');
  });

  it('reports missing CRON_SECRET as NOT_READY', async () => {
    const res = await invoke({ ...baseEnv(), CRON_SECRET: '' });
    expect(res.body.cronSecret.configured).toBe(false);
    expect(res.body.canaryPrerequisites).toBe('NOT_READY');
  });

  it.each(['publish', 'legacy'])('reports mode %s as unsafe and NOT_READY', async (mode) => {
    const res = await invoke({ ...baseEnv(), PORTFOLIO_CLOSE_MODE: mode });
    expect(res.body.closeMode).toEqual({ explicit: true, safeForCapture: false });
    expect(res.body.canaryPrerequisites).toBe('NOT_READY');
  });

  it('distinguishes explicit capture from the technically safe default', async () => {
    const explicit = await invoke();
    expect(explicit.body.closeMode).toEqual({ explicit: true, safeForCapture: true });
    const defaulted = await invoke({ ...baseEnv(), PORTFOLIO_CLOSE_MODE: '' });
    expect(defaulted.body.closeMode).toEqual({ explicit: false, safeForCapture: true });
    expect(defaulted.body.canaryPrerequisites).toBe('NOT_READY');
  });

  it.each(['bad', '17:59'])('reports cutoff %s as invalid or unsafe', async (cutoff) => {
    const res = await invoke({ ...baseEnv(), PORTFOLIO_CAPTURE_CUTOFF_ART: cutoff });
    expect(res.body.cutoff.safe).toBe(false);
    expect(res.body.canaryPrerequisites).toBe('NOT_READY');
  });

  it('uses the reviewed default cutoff safely when it is absent', async () => {
    const res = await invoke({ ...baseEnv(), PORTFOLIO_CAPTURE_CUTOFF_ART: '' });
    expect(res.body.cutoff).toEqual({ configured: false, valid: true, safe: true });
  });

  it('does not import writers or perform network calls and returns no sensitive values', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not fetch'));
    const res = await invoke();
    expect(fetchSpy).not.toHaveBeenCalled();
    const source = await readFile(new URL('../../api/b1-preview-preflight.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\b(?:import|runClose|createRepository|createBymaClient|fetch)\b/);
    const serialized = JSON.stringify(res.body);
    for (const secret of ['project-for-test', 'service-account-for-test', 'private-key-for-test',
      'client-for-test', 'secret-for-test', 'cron-for-test']) expect(serialized).not.toContain(secret);
    expect(res.headers['Cache-Control']).toBe('private, no-store, max-age=0');
  });
});
