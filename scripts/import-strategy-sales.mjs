/* global process */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { StrategyDecimal as D, decimal, dateOnly } from '../src/features/strategies/strategyModel.js';
import { createStrategyOpeningFromLegacy } from '../src/features/strategies/strategyLegacy.js';
import { calculateStrategyLedger, prepareStrategyOperation } from '../src/features/strategies/strategyLedger.js';

const require = createRequire(import.meta.url);
const auth = require('firebase-tools/lib/auth.js');
const scopes = require('firebase-tools/lib/scopes.js');
const PROJECT = 'mi-cartera-tracker';
const OUTPUT = path.resolve('local-data/strategy-sales');
const database = `projects/${PROJECT}/databases/(default)`;
const documents = `${database}/documents`;

function decode(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decode);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields ?? {});
  throw new Error('Tipo de dato Firestore no admitido en la importación.');
}
const decodeFields = fields => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]));
function encode(value) {
  if (value == null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === 'object') return { mapValue: { fields: encodeFields(value) } };
  throw new Error('Dato no serializable.');
}
const encodeFields = fields => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encode(value)]));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const readJson = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const writeJson = async (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
const amount = value => {
  const [integer, fraction] = new D(value).toFixed(2).split('.');
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction}`;
};
const safeId = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(value) || ['.', '..'].includes(value)) throw new Error('Identificador de importación inválido.');
  return value;
};

async function apiClient() {
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error('Iniciar sesión en Firebase CLI antes de importar.');
  const token = await auth.getAccessToken(account.tokens.refresh_token, [scopes.CLOUD_PLATFORM]);
  async function request(resource, body) {
    const response = await fetch(`https://firestore.googleapis.com/v1/${resource}`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? `Firestore respondió ${response.status}.`);
    return result;
  }
  async function list(collection) {
    const result = [];
    let next;
    do {
      const page = await request(`${documents}/${collection}?pageSize=100${next ? `&pageToken=${encodeURIComponent(next)}` : ''}`);
      result.push(...(page.documents ?? [])); next = page.nextPageToken;
    } while (next);
    return result;
  }
  async function snapshot(attempt = 0) {
    const [rotations, brokers] = await Promise.all([list('rotations'), list('brokerPositions')]);
    const strategies = await Promise.all(rotations.map(async document => ({
      document, id: document.name.split('/').at(-1), data: decodeFields(document.fields ?? {}),
      operations: await list(`rotations/${document.name.split('/').at(-1)}/operations`),
    })));
    const fresh = await Promise.all(strategies.map(strategy => request(strategy.document.name)));
    if (fresh.some((document, index) => document.updateTime !== strategies[index].document.updateTime)) {
      if (attempt >= 2) throw new Error('Los datos están cambiando. Reintentar la lectura.');
      return snapshot(attempt + 1);
    }
    return { strategies, brokers };
  }
  return { request, snapshot };
}

// Allocate integer cents by largest remainder, including the unassigned balance.
function allocateMoney(value, parts, totalQuantity) {
  const total = decimal(value, 'Importe').times(100);
  if (!total.isInteger()) throw new Error('El comprobante tiene más de dos decimales monetarios.');
  const shares = parts.map((part, index) => {
    const exact = total.times(part.quantity).div(totalQuantity);
    return { index, cents: exact.floor(), remainder: exact.minus(exact.floor()) };
  });
  const missing = total.minus(shares.reduce((sum, share) => sum.plus(share.cents), new D(0))).toNumber();
  if (!Number.isInteger(missing) || missing < 0 || missing > shares.length) throw new Error('Reparto de centavos inválido.');
  const ordered = [...shares].sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index);
  for (let index = 0; index < missing; index++) ordered[index].cents = ordered[index].cents.plus(1);
  return shares.map(share => share.cents.div(100).toFixed());
}

function buildPlan(receipt, snapshot) {
  if (receipt.version !== 'strategy-receipt-v1' || receipt.projectId !== PROJECT || receipt.currency !== 'ARS') throw new Error('Comprobante o proyecto no admitido.');
  safeId(receipt.importId); dateOnly(receipt.openingDate); dateOnly(receipt.tradeDate); dateOnly(receipt.settlementDate);
  const strategies = new Map();
  const unassigned = [];
  const tickets = new Set();
  let totalNet = new D(0);
  for (const sale of receipt.sales) {
    if (tickets.has(sale.ticket)) throw new Error('Boleto repetido en el comprobante.');
    tickets.add(sale.ticket);
    const totalQuantity = decimal(sale.quantity, 'Cantidad', { positive: true });
    const parts = sale.allocations.map(part => ({ ...part, quantity: decimal(part.quantity, 'Cantidad asignada', { positive: true }).toFixed() }));
    if (new Set(parts.map(part => part.strategyId)).size !== parts.length) throw new Error('Repartir cada boleto una sola vez por estrategia.');
    const remaining = totalQuantity.minus(parts.reduce((sum, part) => sum.plus(part.quantity), new D(0)));
    if (remaining.isNegative()) throw new Error('La asignación excede la venta del boleto.');
    if (remaining.gt(0)) parts.push({ strategyId: null, quantity: remaining.toFixed() });
    const grossParts = allocateMoney(sale.grossAmount, parts, totalQuantity);
    const netParts = allocateMoney(sale.netAmount, parts, totalQuantity);
    totalNet = totalNet.plus(sale.netAmount);
    parts.forEach((part, index) => {
      if (!part.strategyId) {
        unassigned.push({ ticket: sale.ticket, ticker: sale.ticker, quantity: part.quantity, grossAmount: grossParts[index], netAmount: netParts[index] });
        return;
      }
      let strategy = strategies.get(part.strategyId);
      if (!strategy) {
        const current = snapshot.strategies.find(entry => entry.id === part.strategyId);
        if (!current || current.data.isClosed) throw new Error('La estrategia asignada no existe o está cerrada.');
        const opening = current.data.ledgerOpening ?? createStrategyOpeningFromLegacy(current.data, { asOfDate: receipt.openingDate });
        if (opening.asOfDate < current.data.tradeDate) throw new Error('La apertura precede el inicio de la estrategia.');
        const records = current.operations.map(document => ({ ...decodeFields(document.fields ?? {}), id: document.name.split('/').at(-1) }));
        strategy = { id: current.id, name: current.data.eventName, expectedUpdateTime: current.document.updateTime,
          expectedRevision: current.data.ledgerRevision ?? 0, activatesOpening: !current.data.ledgerOpening,
          opening, existingRecords: records, newRecords: [], beforeBalances: calculateStrategyLedger(opening, records) };
        strategies.set(part.strategyId, strategy);
      }
      const id = safeId(`${receipt.importId}-${sale.ticket.replace(/\D/g, '')}-${sale.ticker}`);
      const prepared = prepareStrategyOperation({ opening: strategy.opening, records: [...strategy.existingRecords, ...strategy.newRecords], input: {
        id, type: 'sell', tradeDate: receipt.tradeDate, settlementDate: receipt.settlementDate,
        ticker: sale.ticker, currency: receipt.currency, quantity: part.quantity,
        price: new D(grossParts[index]).div(part.quantity).toFixed(), netAmount: netParts[index],
        sourceOperationId: sale.ticket, broker: receipt.broker,
        note: 'Venta del comprobante. Cantidad asignada a esta estrategia; bruto y neto prorrateados por cantidad con reparto exacto de centavos. Precio equivalente del bruto asignado.',
      } });
      if (!new D(prepared.operation.grossAmount).eq(grossParts[index])) throw new Error('El precio equivalente no conserva el bruto asignado.');
      strategy.newRecords.push({ ...prepared.operation, status: 'active', recordedBy: 'codex-import', recordedVia: 'codex-desktop', importId: receipt.importId,
        sourceReceipt: { ticket: sale.ticket, quantity: sale.quantity, grossAmount: sale.grossAmount, netAmount: sale.netAmount, sourceFile: receipt.sourceFile },
      });
      strategy.afterBalances = prepared.balances;
    });
  }
  const result = [...strategies.values()];
  const assignedNet = result.reduce((sum, strategy) => sum.plus(strategy.newRecords.reduce((subtotal, record) => subtotal.plus(record.netAmount), new D(0))), new D(0));
  const unassignedNet = unassigned.reduce((sum, entry) => sum.plus(entry.netAmount), new D(0));
  if (!assignedNet.plus(unassignedNet).eq(totalNet)) throw new Error('El reparto no conserva el neto del comprobante.');
  return { version: 'strategy-import-plan-v1', projectId: PROJECT, importId: receipt.importId, preparedAt: new Date().toISOString(),
    receipt, strategies: result, unassigned, totals: { receiptNet: totalNet.toFixed(), assignedNet: assignedNet.toFixed(), unassignedNet: unassignedNet.toFixed() } };
}

function report(plan) {
  const lines = ['# Propuesta de carga de ventas', '', `Comprobante: ${plan.receipt.tradeDate} · Apertura propuesta: ${plan.receipt.openingDate}`, '',
    'El reparto por estrategia requiere confirmación. Los netos y brutos se prorratean por cantidad, conservando todos los centavos del boleto. Los precios equivalentes reflejan el bruto asignado.', '',
    '| Estrategia | Ventas a registrar | Neto recibido ARS | Efectivo posterior ARS |', '|---|---|---:|---:|'];
  for (const strategy of plan.strategies) {
    const net = strategy.newRecords.reduce((sum, record) => sum.plus(record.netAmount), new D(0));
    lines.push(`| ${strategy.name} | ${strategy.newRecords.map(record => `${record.ticker} ${record.quantity}`).join('; ')} | ${amount(net)} | ${amount(strategy.afterBalances.cash.ARS)} |`);
  }
  lines.push('', '## Posiciones restantes', '');
  for (const strategy of plan.strategies) lines.push(`- **${strategy.name}:** ${strategy.afterBalances.positions.map(position => `${position.ticker} ${position.quantity}`).join('; ') || 'Sin títulos'}.`);
  lines.push('', '## Ventas sin estrategia confirmada', '');
  for (const entry of plan.unassigned) lines.push(`- ${entry.ticker}: ${entry.quantity} unidades; neto proporcional ARS ${amount(entry.netAmount)}.`);
  lines.push('', `Neto total de ventas: ARS ${amount(plan.totals.receiptNet)}.`, `Asignado a estrategias: ARS ${amount(plan.totals.assignedNet)}.`, `Sin asignar: ARS ${amount(plan.totals.unassignedNet)}.`, '',
    'Compras Agosto no recibe cambios. Los documentos originales quedan preservados; se agrega apertura, operaciones y saldo derivado. No se registra ninguna compra del comprobante ni se escriben saldos globales.', '');
  return lines.join('\n');
}

function writeFor(name, fields, condition, timestamps) {
  return { update: { name, fields: encodeFields(fields) }, updateMask: { fieldPaths: Object.keys(fields) }, currentDocument: condition,
    updateTransforms: timestamps.map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) };
}
function brokerVersions(brokers) { return Object.fromEntries(brokers.map(document => [document.name, document.updateTime]).sort(([a], [b]) => a.localeCompare(b))); }

async function applyPlan(plan, api) {
  if (plan.version !== 'strategy-import-plan-v1' || plan.projectId !== PROJECT) throw new Error('Plan no admitido.');
  const before = await api.snapshot();
  const recalculated = buildPlan(plan.receipt, before);
  if (hash(recalculated.strategies) !== hash(plan.strategies) || hash(recalculated.unassigned) !== hash(plan.unassigned)) throw new Error('Los datos cambiaron desde la propuesta. Preparar y revisar un plan nuevo.');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeJson(path.join(OUTPUT, `before-apply-${stamp}.json`), { plan, snapshot: before });
  const writes = [];
  for (const strategy of plan.strategies) {
    const records = [...strategy.existingRecords, ...strategy.newRecords];
    const parentFields = { ledgerBalances: strategy.afterBalances, ledgerRevision: strategy.expectedRevision + 1,
      ledgerOperationCount: records.length, ledgerActiveCount: records.filter(record => record.status === 'active').length,
      ledgerLastImportId: plan.importId,
      ...(strategy.activatesOpening ? { ledgerOpening: strategy.opening, ledgerOpeningRecordedBy: 'codex-import' } : {}),
    };
    writes.push(writeFor(`${documents}/rotations/${safeId(strategy.id)}`, parentFields, { updateTime: strategy.expectedUpdateTime },
      ['ledgerUpdatedAt', ...(strategy.activatesOpening ? ['ledgerOpeningRecordedAt'] : [])]));
    for (const record of strategy.newRecords) writes.push(writeFor(`${documents}/rotations/${safeId(strategy.id)}/operations/${safeId(record.id)}`, record, { exists: false }, ['recordedAt']));
  }
  if (writes.some(write => !write.update.name.startsWith(`${documents}/rotations/`))) throw new Error('Escritura fuera de estrategias bloqueada.');
  const response = await api.request(`${documents}:commit`, { writes });
  await writeJson(path.join(OUTPUT, `commit-${stamp}.json`), { importId: plan.importId, commit: response });
  const after = await api.snapshot();
  const verification = plan.strategies.map(strategy => {
    const persisted = after.strategies.find(entry => entry.id === strategy.id);
    const records = persisted.operations.map(document => ({ ...decodeFields(document.fields), id: document.name.split('/').at(-1) }));
    const balances = calculateStrategyLedger(persisted.data.ledgerOpening, records);
    return { id: strategy.id, name: strategy.name, matchesPlan: hash(balances) === hash(strategy.afterBalances),
      matchesCache: hash(balances) === hash(persisted.data.ledgerBalances), balances };
  });
  const result = { commitTime: response.commitTime, writes: writes.length, verification,
    brokerVersionsUnchanged: hash(brokerVersions(before.brokers)) === hash(brokerVersions(after.brokers)),
  };
  await writeJson(path.join(OUTPUT, `after-apply-${stamp}.json`), { result, snapshot: after });
  console.log(JSON.stringify(result, null, 2));
  if (verification.some(entry => !entry.matchesPlan || !entry.matchesCache)) throw new Error('La escritura se realizó; la lectura posterior requiere revisión. No reintentar el alta.');
}

async function main() {
  const [mode, file] = process.argv.slice(2);
  if (!['--preview', '--apply'].includes(mode) || !file) throw new Error('Uso: node scripts/import-strategy-sales.mjs --preview comprobante.json | --apply plan.json');
  await fs.mkdir(OUTPUT, { recursive: true });
  const input = await readJson(file);
  const api = await apiClient();
  if (mode === '--apply') return applyPlan(input, api);
  const snapshot = await api.snapshot();
  const plan = buildPlan(input, snapshot);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const planFile = path.join(OUTPUT, `plan-${stamp}.json`);
  const reportFile = path.join(OUTPUT, `proposal-${stamp}.md`);
  await writeJson(path.join(OUTPUT, `backup-${stamp}.json`), snapshot);
  await writeJson(planFile, plan);
  await fs.writeFile(reportFile, report(plan), { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({ mode: 'preview', planFile, reportFile, operationCount: plan.strategies.reduce((sum, entry) => sum + entry.newRecords.length, 0),
    totals: plan.totals, strategies: plan.strategies.map(entry => ({ name: entry.name, sales: entry.newRecords.map(record => ({ ticker: record.ticker, quantity: record.quantity, net: record.netAmount })), cashAfter: entry.afterBalances.cash.ARS })), unassigned: plan.unassigned }, null, 2));
}
export { PROJECT, OUTPUT, documents, decodeFields, hash, readJson, writeJson, apiClient, buildPlan, writeFor, brokerVersions };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
