const EXPECTED_BRANCH = 'codex/b1-durable-close-capture';
const EXPECTED_REPO_OWNER = 'jpasman82';
const EXPECTED_REPO_SLUG = 'portfolio-tracker';
const MINIMUM_CUTOFF_ART = '18:00';

const present = (value) => typeof value === 'string' && value.trim().length > 0;

function completeServiceAccountJson(value) {
  if (!present(value)) return false;
  try {
    const account = JSON.parse(value);
    return Boolean(account && typeof account === 'object'
      && present(account.client_email || account.clientEmail)
      && present(account.private_key || account.privateKey));
  } catch {
    return false;
  }
}

function firebaseAdminStatus(env) {
  if (present(env.FIREBASE_SERVICE_ACCOUNT_KEY)) {
    const complete = completeServiceAccountJson(env.FIREBASE_SERVICE_ACCOUNT_KEY);
    return { configured: complete, strategy: complete ? 'SERVICE_ACCOUNT_JSON' : 'NONE' };
  }
  const splitFields = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
  if (splitFields.every((name) => present(env[name]))) {
    return { configured: true, strategy: 'SPLIT_FIELDS' };
  }
  return { configured: false, strategy: 'NONE' };
}

function bymaStatus(env) {
  const serverAny = present(env.BYMA_CLIENT_ID) || present(env.BYMA_CLIENT_SECRET);
  if (present(env.BYMA_CLIENT_ID) && present(env.BYMA_CLIENT_SECRET)) {
    return { configured: true, source: 'SERVER_NAMES' };
  }
  if (!serverAny && present(env.VITE_BYMA_CLIENT_ID) && present(env.VITE_BYMA_CLIENT_SECRET)) {
    return { configured: true, source: 'LEGACY_NAMES' };
  }
  return { configured: false, source: 'NONE' };
}

function closeModeStatus(env) {
  const explicit = present(env.PORTFOLIO_CLOSE_MODE);
  const mode = explicit ? env.PORTFOLIO_CLOSE_MODE : 'capture';
  return { explicit, safeForCapture: mode === 'capture' };
}

function cutoffStatus(env) {
  const configured = present(env.PORTFOLIO_CAPTURE_CUTOFF_ART);
  const cutoff = configured ? env.PORTFOLIO_CAPTURE_CUTOFF_ART : MINIMUM_CUTOFF_ART;
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff);
  return { configured, valid, safe: valid && cutoff >= MINIMUM_CUTOFF_ART };
}

export function inspectPreviewEnvironment(env) {
  const firebaseAdmin = firebaseAdminStatus(env);
  const byma = bymaStatus(env);
  const cronSecret = { configured: present(env.CRON_SECRET) };
  const closeMode = closeModeStatus(env);
  const cutoff = cutoffStatus(env);
  const ready = firebaseAdmin.configured && byma.configured && cronSecret.configured
    && closeMode.explicit && closeMode.safeForCapture && cutoff.valid && cutoff.safe;

  return {
    ok: ready,
    environment: 'preview',
    branchOk: true,
    repositoryOk: true,
    firebaseAdmin,
    byma,
    cronSecret,
    closeMode,
    cutoff,
    canaryPrerequisites: ready ? 'READY' : 'NOT_READY',
  };
}

function passesHardGates(env) {
  if (env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_COMMIT_REF !== EXPECTED_BRANCH) return false;
  if (present(env.VERCEL_GIT_REPO_OWNER) && env.VERCEL_GIT_REPO_OWNER !== EXPECTED_REPO_OWNER) return false;
  if (present(env.VERCEL_GIT_REPO_SLUG) && env.VERCEL_GIT_REPO_SLUG !== EXPECTED_REPO_SLUG) return false;
  return true;
}

export default function handler(req, res) {
  if (!passesHardGates(process.env)) return res.status(404).end();
  if (req.method !== 'GET') return res.status(405).end();

  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  return res.status(200).json(inspectPreviewEnvironment(process.env));
}
