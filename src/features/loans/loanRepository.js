import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { calculateLoanAtDate } from './loanEngine.js';
import {
  deserializeLoanFromFirestore,
  deserializeMovementFromFirestore,
  normalizeLoanMetadataUpdate,
  serializeLoanForFirestore,
  serializeMovementForFirestore,
  toLoanEngineDefinition,
  toLoanEngineMovement,
} from './loanSerialization.js';

const TERMINAL_STATUSES = new Set(['closed', 'cancelled']);

function requirePathSegment(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('/')) {
    throw new Error(`${fieldName} must be a non-empty Firestore path segment`);
  }

  return value;
}

function loansCollection(db, uid) {
  return collection(db, 'users', requirePathSegment(uid, 'uid'), 'nonBrokerAssets');
}

function loanDocument(db, uid, assetId) {
  return doc(loansCollection(db, uid), requirePathSegment(assetId, 'assetId'));
}

function movementsCollection(db, uid, assetId) {
  return collection(loanDocument(db, uid, assetId), 'movements');
}

function withId(snapshot, deserialize) {
  return {
    id: snapshot.id,
    ...deserialize(snapshot.data()),
  };
}

function requireExistingLoan(snapshot, assetId) {
  if (!snapshot.exists()) {
    throw new Error(`Loan ${assetId} does not exist`);
  }

  return withId(snapshot, deserializeLoanFromFirestore);
}

function validateStatusTransition(currentStatus, nextStatus) {
  if (TERMINAL_STATUSES.has(currentStatus) && nextStatus !== currentStatus) {
    throw new Error(`Loan status cannot transition from terminal status ${currentStatus}`);
  }
}

function createInitialMovement(loan, initialContribution) {
  const input =
    typeof initialContribution === 'string'
      ? { amount: initialContribution }
      : initialContribution;

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('initialContribution must be an amount string or an object');
  }
  const extraFields = Object.keys(input).filter((key) => !['amount', 'note'].includes(key));
  if (extraFields.length > 0) {
    throw new Error(`initialContribution contains unsupported fields: ${extraFields.sort().join(', ')}`);
  }

  return {
    effectiveDate: loan.startDate,
    type: 'contribution',
    amount: input.amount,
    ...(input.note === undefined ? {} : { note: input.note }),
  };
}

export function createLoanRepository(db) {
  if (!db) {
    throw new Error('Firestore db is required');
  }

  async function listLoans(uid) {
    const snapshot = await getDocs(loansCollection(db, uid));
    return snapshot.docs.map((item) => withId(item, deserializeLoanFromFirestore));
  }

  async function getLoan(uid, assetId) {
    const snapshot = await getDoc(loanDocument(db, uid, assetId));
    return snapshot.exists() ? withId(snapshot, deserializeLoanFromFirestore) : null;
  }

  async function listMovements(uid, assetId) {
    const snapshot = await getDocs(
      query(movementsCollection(db, uid, assetId), orderBy('effectiveDate')),
    );

    return snapshot.docs.map((item) => withId(item, deserializeMovementFromFirestore));
  }

  async function createLoan(uid, loanInput, initialContribution) {
    const ownerUid = requirePathSegment(uid, 'uid');
    const timestamp = serverTimestamp();
    const loan = serializeLoanForFirestore(
      {
        ...loanInput,
        status: loanInput?.status === undefined ? 'active' : loanInput.status,
      },
      { createdAt: timestamp, updatedAt: timestamp },
    );

    if (loan.status !== 'active') {
      throw new Error('A new loan must have active status');
    }

    const movement = serializeMovementForFirestore(
      createInitialMovement(loan, initialContribution),
      { createdAt: timestamp },
    );
    const loanRef = doc(loansCollection(db, ownerUid));
    const movementRef = doc(collection(loanRef, 'movements'));
    const batch = writeBatch(db);

    batch.set(loanRef, loan);
    batch.set(movementRef, movement);
    await batch.commit();

    return { assetId: loanRef.id, movementId: movementRef.id };
  }

  async function updateLoanMetadata(uid, assetId, changes) {
    const reference = loanDocument(db, uid, assetId);
    const current = requireExistingLoan(await getDoc(reference), assetId);
    const normalized = normalizeLoanMetadataUpdate(changes, serverTimestamp());

    if (normalized.status !== undefined) {
      validateStatusTransition(current.status, normalized.status);
    }

    await updateDoc(reference, normalized);
  }

  async function addMovement(uid, assetId, movementInput) {
    const loan = requireExistingLoan(
      await getDoc(loanDocument(db, uid, assetId)),
      assetId,
    );

    if (loan.status !== 'active') {
      throw new Error(`Cannot add movements to a loan with status ${loan.status}`);
    }

    const serialized = serializeMovementForFirestore(movementInput, {
      createdAt: serverTimestamp(),
    });
    const knownMovements = await listMovements(uid, assetId);
    const engineMovements = [
      ...knownMovements.map(toLoanEngineMovement),
      toLoanEngineMovement(serialized),
    ];

    calculateLoanAtDate({
      loan: toLoanEngineDefinition(loan),
      movements: engineMovements,
      asOfDate: serialized.effectiveDate,
    });

    const reference = doc(movementsCollection(db, uid, assetId));
    await setDoc(reference, serialized);
    return reference.id;
  }

  return {
    listLoans,
    getLoan,
    createLoan,
    updateLoanMetadata,
    listMovements,
    addMovement,
  };
}
