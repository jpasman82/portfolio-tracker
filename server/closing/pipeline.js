import { randomUUID } from 'node:crypto';
import { VERSION, BYMA_DATE_CONTRACT, freezeInputs, normalize, selectRequirement, hash } from './model.js';
import { publicError } from './repository.js';
import { updatePositionsAndBuildSnapshot } from './legacy.js';

const fail = (code) => Object.assign(new Error(code), { code });

export async function buildFromDurable(input, selected, observations, date, capturedAt) {
  const byId = new Map(observations.map((o) => [o.id, o]));
  const prices = new Map();
  for (const requirement of input.requirements) {
    const o = byId.get(selected[requirement.key]);
    if (!o || o.status !== 'VALID' || o.priceType !== 'CLOSING_PRICE' || o.source !== 'BYMA'
      || o.normalizerVersion !== VERSION || !o.dateEvidence?.reference || o.priceDate !== date || !(o.price > 0)
      || !requirement.groups.includes(o.group) || !requirement.symbols.includes(o.providerSymbol)) throw fail('MISSING_REQUIRED_INPUT');
    prices.set(requirement.key, o.price);
  }
  const mep = prices.get('fx:MEP:ARS') / prices.get('fx:MEP:USD');
  if (!(mep > 0) || !Number.isFinite(mep)) throw fail('INVALID_MEP');
  const assetPrices = new Map(input.bindings.map((binding) => [
    `${binding.brokerId}:${binding.ticker}`, prices.get(binding.key) / (binding.convertToUSD ? mep : 1),
  ]));
  const { positionUpdates: _unusedUpdates, ...snapshot } = await updatePositionsAndBuildSnapshot({
    positions: input.positions, valuationDate: date, capturedAt,
    marketData: { prices: {}, usdBondSymbols: new Set(), mep, cable: null },
    priceForAsset: (brokerId, ticker) => assetPrices.get(`${brokerId}:${ticker}`),
  });
  // The existing calculation remains the UI adapter, not a new valuation engine.
  if (Object.values(snapshot.totals).some((n) => !Number.isFinite(n))) throw fail('INVALID_VALUATION');
  const selectedIds = Object.entries(selected).sort(([a], [b]) => a.localeCompare(b));
  return { ...snapshot, isComplete: true, economicStatus: 'COMPLETE', policyVersion: VERSION,
    marketPriceRunRef: `marketPriceRuns/${date}`, inputHash: input.inputHash,
    b1BuildId: hash([date, input.inputHash, selectedIds, VERSION]) };
}

export async function runClose({ date, repo, byma, loadPositions, publish = false,
  archive = null, contract = BYMA_DATE_CONTRACT, now = () => new Date().toISOString(),
  log = (entry) => console.info(JSON.stringify(entry)), build = buildFromDurable,
  attemptId = randomUUID() }) {
  let lease;
  let stage = 'ACQUIRE';
  let state;
  const started = Date.now();
  const event = (name, extra = {}) => log({ event: name, valuationDate: date, attemptId, stage, ...extra });
  // Serialize checkpoint writes within this worker; provider requests still run
  // concurrently and each successful response is persisted as soon as it resolves.
  let writeQueue = Promise.resolve();
  const enqueue = (work) => {
    const pending = writeQueue.then(work);
    writeQueue = pending.catch(() => {});
    return pending;
  };
  try {
    ({ lease, run: state } = await repo.acquire(date, attemptId));
    event('close_attempt_started', { attemptCount: state.attemptCount });
    if (state.publicationStatus === 'PUBLISHED') {
      const published = await repo.store.get(`portfolioDailySnapshots/${date}`);
      if (!published || published.data.b1BuildId !== state.b1BuildId
        || hash(published.data) !== state.b1SnapshotHash) throw fail('PUBLISHED_SNAPSHOT_CHANGED');
      return state;
    }
    if (!publish && state.status === 'COMPLETE') return state;
    stage = 'INPUTS';
    await repo.update(date, lease, { stage, lastError: null });
    let input = await repo.input(date);
    if (!input) {
      input = freezeInputs(await loadPositions(), now());
      await repo.freeze(date, lease, input);
      input = await repo.input(date); // Build only from acknowledged durable input.
    }
    if (!input) throw fail('INPUT_PERSISTENCE_FAILED');
    stage = 'CAPTURE';
    state = await repo.update(date, lease, { stage });
    let observations = await repo.observations(date);
    const selected = { ...state.selected };
    const pending = input.requirements.filter((r) => !selected[r.key]);
    const groups = [...new Set(pending.flatMap((r) => r.groups))];
    const results = await Promise.allSettled(groups.map(async (group) => {
      let archiveStatus = archive ? 'FAILED' : 'NOT_CONFIGURED';
      let groupStage = 'BYMA';
      try {
        const body = await byma.fetchGroup(group);
        groupStage = 'NORMALIZE';
        const capturedAt = now();
        const relevant = body.result.filter((row) => input.requirements.some((r) => r.groups.includes(group)
          && r.symbols.includes(String(row?.symbol || '').trim().toUpperCase())));
        const normalized = relevant.flatMap((row) => normalize(row, group, date, capturedAt, attemptId, contract));
        // Mandatory durable observations come BEFORE the optional archive.
        groupStage = 'PERSIST_OBSERVATIONS';
        await enqueue(() => repo.saveObservations(date, lease, normalized));
        if (archive) {
          let timer;
          const controller = new AbortController();
          try {
            await Promise.race([archive.put({ group, valuationDate: date, capturedAt, attemptId, body, signal: controller.signal }),
              new Promise((_, reject) => { timer = setTimeout(() => {
                controller.abort(); reject(fail('ARCHIVE_TIMEOUT'));
              }, 1_000); })]);
            archiveStatus = 'COMPLETE';
          } catch { event('archive_degraded', { group }); }
          finally { clearTimeout(timer); }
        }
        groupStage = 'CHECKPOINT_GROUP';
        await enqueue(() => repo.endpoint(date, lease, group,
          { status: 'OK', rows: body.result.length, relevantRows: relevant.length, capturedAt, attemptId }, archiveStatus));
        event('group_persisted', { group, rows: body.result.length, observations: normalized.length });
      } catch (error) {
        error.closeStage = `${groupStage}:${group}`;
        event('group_failed', { group, error: publicError(error, error.closeStage, attemptId) });
        await enqueue(() => repo.endpoint(date, lease, group,
          { status: 'FAILED', error: publicError(error, error.closeStage, attemptId), attemptId }, archiveStatus));
        throw error;
      }
    }));
    await writeQueue;
    stage = 'RECONCILE';
    state = await repo.update(date, lease, { stage });
    observations = await repo.observations(date);
    const rejected = [];
    for (const requirement of pending) {
      const choice = selectRequirement(requirement, observations);
      // Both equity groups must have returned before declaring a symbol unique.
      const groupsKnown = requirement.groups.every((g) => state.endpointResults[g]?.status === 'OK');
      if (choice.observation && groupsKnown) selected[requirement.key] = choice.observation.id;
      else rejected.push({ key: requirement.key, reason: groupsKnown ? choice.reason : 'GROUP_UNAVAILABLE' });
    }
    const valid = input.requirements.filter((r) => selected[r.key]).map((r) => r.key);
    const missing = input.requirements.filter((r) => !selected[r.key]).map((r) => r.key);
    const failed = results.find((r) => r.status === 'rejected');
    const summary = { selected, valid, missing, rejected,
      status: missing.length ? (valid.length || observations.length ? 'PARTIAL' : 'FAILED') : 'PENDING',
      stage: missing.length ? 'AWAITING_RETRY' : 'BUILD', completedAt: null,
      lastError: failed ? publicError(failed.reason, failed.reason.closeStage || 'CAPTURE', attemptId)
        : missing.length ? publicError(fail('MISSING_REQUIRED_INPUT'), 'VALIDATE', attemptId) : null };
    state = await repo.update(date, lease, summary);
    if (missing.length) { event('close_partial', { valid: valid.length, missing }); return state; }
    if (Date.now() - started > 45_000) throw fail('EXECUTION_BUDGET_EXHAUSTED');
    stage = 'BUILD';
    const snapshot = await build(input, selected, observations, date, now());
    const complete = { ...summary, status: 'COMPLETE', stage: 'CAPTURE_COMPLETE', completedAt: now() };
    if (publish) {
      stage = 'PUBLISH';
      state = await repo.publish(date, lease, snapshot, complete);
    } else state = await repo.update(date, lease, { ...complete, b1BuildId: snapshot.b1BuildId });
    event('close_complete', { publicationStatus: state.publicationStatus, archiveStatus: state.archiveStatus });
    return state;
  } catch (error) {
    event('close_failed', { error: publicError(error, stage, attemptId) });
    if (lease && error.code !== 'LEASE_LOST') {
      try { state = await repo.update(date, lease, { status: 'FAILED', stage,
        completedAt: null, lastError: publicError(error, stage, attemptId) }); }
      catch (checkpointError) { event('failure_checkpoint_failed', { error: publicError(checkpointError, stage, attemptId) }); }
    }
    throw error;
  } finally {
    if (lease) {
      try { await repo.release(date, lease); }
      catch (error) { event('lease_release_failed', { error: publicError(error, 'RELEASE', attemptId) }); }
    }
  }
}
