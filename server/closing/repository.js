import { encodeFirestoreValue, decodeFirestoreFields } from './legacy.js';
import { VERSION, TIMEZONE, hash } from './model.js';

export const RUNS = 'marketPriceRuns';
const fields = (data) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, encodeFirestoreValue(v)]));
const fail = (code) => Object.assign(new Error(code), { code });
export const publicError = (error, stage, attemptId) => ({
  code: error.code || 'UNEXPECTED_ERROR', stage, attemptId,
  httpStatus: error.httpStatus || null,
});

export function createRestStore({ projectId, getToken, fetchImpl = fetch, emulatorHost }) {
  if (emulatorHost && (!projectId.startsWith('demo-') || !/^127\.0\.0\.1:\d+$/.test(emulatorHost))) {
    throw fail('UNSAFE_EMULATOR_TARGET');
  }
  const root = `projects/${projectId}/databases/(default)/documents`;
  const base = `${emulatorHost ? `http://${emulatorHost}` : 'https://firestore.googleapis.com'}/v1/${root}`;
  async function request(path, options = {}) {
    const token = await getToken();
    const response = await fetchImpl(`${base}${path}`, { ...options, signal: AbortSignal.timeout(8_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
    if (response.status === 404 && !options.method) return null;
    if (!response.ok) throw Object.assign(fail('FIRESTORE_REQUEST_FAILED'), { httpStatus: response.status });
    return response.json();
  }
  return {
    async get(path) {
      const doc = await request(`/${path}`);
      return doc ? { data: decodeFirestoreFields(doc.fields), version: doc.updateTime } : null;
    },
    async list(path) {
      const result = [];
      let pageToken;
      do {
        const query = new URLSearchParams({ pageSize: '100', ...(pageToken ? { pageToken } : {}) });
        const page = await request(`/${path}?${query}`);
        for (const doc of page?.documents || []) result.push({ id: doc.name.split('/').pop(),
          data: decodeFirestoreFields(doc.fields), updateTime: doc.updateTime });
        pageToken = page?.nextPageToken;
      } while (pageToken);
      return result;
    },
    async commit(writes) {
      const encoded = writes.map(({ path, data, version }) => ({
        update: { name: `${root}/${path}`, fields: fields(data) },
        currentDocument: version ? { updateTime: version } : { exists: false },
      }));
      // Explicit size guard below Firestore's document/request ceilings.
      if (encoded.some((w) => Buffer.byteLength(JSON.stringify(w.update)) > 900_000)) throw fail('DOCUMENT_TOO_LARGE');
      if (Buffer.byteLength(JSON.stringify(encoded)) > 9_000_000) throw fail('COMMIT_TOO_LARGE');
      await request(':commit', { method: 'POST', body: JSON.stringify({ writes: encoded }) });
    },
  };
}

export function createRepository(store, now = () => new Date().toISOString()) {
  const path = (date) => `${RUNS}/${date}`;
  // updateTime CAS in an atomic Commit: the run document is the fencing record
  // for every observation/input/publication write. No external calls are hidden
  // inside Firestore transaction callbacks. Retry also reconciles lost ACKs.
  async function mutate(date, lease, operation) {
    let lastError;
    for (let retry = 0; retry < 5; retry += 1) {
      const current = await store.get(path(date));
      const run = current?.data;
      if (lease && (!run || run.lease?.owner !== lease.owner || run.lease?.token !== lease.token
        || run.lease.expiresAt <= now())) throw fail('LEASE_LOST');
      const change = await operation(run);
      if (!change) return run;
      if (lease && run.lease.expiresAt <= now()) throw fail('LEASE_LOST');
      try {
        await store.commit([{ path: path(date), data: change.run, version: current?.version }, ...(change.writes || [])]);
        return change.run;
      } catch (error) {
        lastError = error;
        if (error.code === 'DOCUMENT_TOO_LARGE' || error.code === 'COMMIT_TOO_LARGE'
          || [400, 401, 403].includes(error.httpStatus)) throw error;
        // A conflict or uncertain commit must be re-read, never blindly replayed.
      }
    }
    throw lastError;
  }
  return {
    store,
    async acquire(date, owner) {
      const run = await mutate(date, null, (existing) => {
        if (existing?.lease?.owner === owner && existing.lease.expiresAt > now()) return null;
        if (existing?.lease?.expiresAt > now()) throw fail('LEASE_BUSY');
        if (existing && existing.policyVersion !== VERSION) throw fail('POLICY_VERSION_MISMATCH');
        const timestamp = now();
        const base = existing || { valuationDate: date, timezone: TIMEZONE, status: 'PENDING', stage: 'STARTED',
          startedAt: timestamp, completedAt: null, attemptCount: 0, expectedQuoteKeys: [], valid: [],
          missing: [], rejected: [], lastError: null, version: VERSION, policyVersion: VERSION,
          archiveStatus: 'NOT_CONFIGURED', archiveResults: {}, endpointResults: {}, selected: {},
          inputHash: null, publicationStatus: 'NOT_REQUESTED' };
        return { run: { ...base, lastAttemptAt: timestamp, attemptCount: base.attemptCount + 1,
          lease: { owner, token: (existing?.lease?.token || 0) + 1,
            expiresAt: new Date(Date.parse(timestamp) + 70_000).toISOString() } } };
      });
      return { run, lease: run.lease };
    },
    async update(date, lease, changes) {
      return mutate(date, lease, (run) => ({ run: { ...run, ...changes } }));
    },
    async freeze(date, lease, input) {
      return mutate(date, lease, async (run) => {
        if (run.inputHash) return null;
        return { run: { ...run, inputHash: input.inputHash, expectedQuoteKeys: input.requirements.map((r) => r.key) },
          writes: [{ path: `${path(date)}/inputs/frozen`, data: input }] };
      });
    },
    async input(date) { return (await store.get(`${path(date)}/inputs/frozen`))?.data; },
    async observations(date) { return (await store.list(`${path(date)}/observations`)).map((o) => o.data); },
    async saveObservations(date, lease, observations) {
      const unique = [...new Map(observations.map((o) => [o.id, o])).values()];
      for (let start = 0; start < unique.length; start += 30) {
        const chunk = unique.slice(start, start + 30);
        await mutate(date, lease, async (run) => {
          const writes = (await Promise.all(chunk.map(async (observation) => {
            const docPath = `${path(date)}/observations/${observation.id}`;
            return !await store.get(docPath) ? { path: docPath, data: observation } : null;
          }))).filter(Boolean);
          return { run: { ...run, lastDurableProgressAt: now() }, writes };
        });
      }
    },
    async endpoint(date, lease, group, result, archiveResult) {
      return mutate(date, lease, (run) => {
        const archiveResults = { ...run.archiveResults, [group]: archiveResult };
        const statuses = Object.values(archiveResults);
        const archiveStatus = statuses.every((s) => s === 'NOT_CONFIGURED') ? 'NOT_CONFIGURED'
          : statuses.every((s) => s === 'COMPLETE') ? 'COMPLETE'
            : statuses.every((s) => s === 'FAILED') ? 'FAILED' : 'DEGRADED';
        return { run: { ...run, endpointResults: { ...run.endpointResults, [group]: result }, archiveResults, archiveStatus } };
      });
    },
    async publish(date, lease, snapshot, summary) {
      return mutate(date, lease, async (run) => {
        const target = `portfolioDailySnapshots/${date}`;
        const existing = await store.get(target);
        if (existing && (existing.data.b1BuildId !== snapshot.b1BuildId || hash(existing.data) !== hash(snapshot))) {
          throw fail('EXISTING_SNAPSHOT_CONFLICT');
        }
        const writes = existing ? [] : [{ path: target, data: snapshot }];
        return { run: { ...run, ...summary, publicationStatus: 'PUBLISHED', stage: 'PUBLISHED',
          b1BuildId: snapshot.b1BuildId, b1SnapshotHash: hash(snapshot) }, writes };
      });
    },
    async release(date, lease) {
      return mutate(date, lease, (run) => ({ run: { ...run, lease: { ...run.lease, expiresAt: now() } } }));
    },
  };
}
