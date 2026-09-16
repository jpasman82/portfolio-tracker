import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  deserializeLoanFromFirestore,
  deserializeMovementFromFirestore,
  deserializeTermsChangeFromFirestore,
  normalizeLoanMetadataUpdate,
  serializeLoanForFirestore,
  serializeMovementForFirestore,
  serializeTermsChangeForFirestore,
} from './loanSerialization.js';
import {
  prepareMovementCorrection,
  validateCompleteLoanLedger,
} from './loanMovements.js';
import { calculateLoanTermsChangePreview } from './loanTerms.js';

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

function termsChangesCollection(db, uid, assetId) {
  return collection(loanDocument(db, uid, assetId), 'termsChanges');
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

function staleTermsRevisionError(expectedRevision, currentRevision) {
  const error = new Error(
    `Loan terms revision is stale: expected ${expectedRevision}, current ${currentRevision}`,
  );
  error.name = 'StaleLoanTermsRevisionError';
  error.code = 'STALE_LOAN_TERMS_REVISION';
  error.expectedRevision = expectedRevision;
  error.currentRevision = currentRevision;
  return error;
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

  async function listTermsChanges(uid, assetId) {
    const snapshot = await getDocs(
      query(termsChangesCollection(db, uid, assetId), orderBy('createdAt')),
    );

    return snapshot.docs.map((item) => withId(item, deserializeTermsChangeFromFirestore));
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
    validateCompleteLoanLedger({ loan, movements: [...knownMovements, serialized] });

    const reference = doc(movementsCollection(db, uid, assetId));
    await setDoc(reference, serialized);
    return reference.id;
  }

  async function correctMovement(uid, assetId, movementId, correctedData) {
    const loan = requireExistingLoan(
      await getDoc(loanDocument(db, uid, assetId)),
      assetId,
    );

    if (loan.status !== 'active') {
      throw new Error(`Cannot correct movements on a loan with status ${loan.status}`);
    }

    const knownMovements = await listMovements(uid, assetId);
    const correction = prepareMovementCorrection({
      movements: knownMovements,
      movementId: requirePathSegment(movementId, 'movementId'),
      correctedData,
    });
    validateCompleteLoanLedger({ loan, movements: correction.resultingMovements });

    const timestamp = serverTimestamp();
    const reversal = serializeMovementForFirestore(correction.reversal, { createdAt: timestamp });
    const replacement = serializeMovementForFirestore(correction.replacement, { createdAt: timestamp });
    const reversalRef = doc(movementsCollection(db, uid, assetId));
    const replacementRef = doc(movementsCollection(db, uid, assetId));
    const batch = writeBatch(db);

    batch.set(reversalRef, reversal);
    batch.set(replacementRef, replacement);
    await batch.commit();

    return {
      reversalMovementId: reversalRef.id,
      replacementMovementId: replacementRef.id,
    };
  }

  async function previewLoanTermsChange(uid, assetId, input) {
    const loan = requireExistingLoan(
      await getDoc(loanDocument(db, uid, assetId)),
      assetId,
    );
    const movements = await listMovements(uid, assetId);
    return {
      revision: loan.revision,
      ...calculateLoanTermsChangePreview({
        loan,
        movements,
        kind: input?.kind,
        changes: input?.changes,
        asOfDate: input?.asOfDate,
      }),
    };
  }

  async function applyLoanTermsChange(uid, assetId, input) {
    requirePathSegment(uid, 'uid');
    requirePathSegment(assetId, 'assetId');
    if (!Number.isSafeInteger(input?.expectedRevision) || input.expectedRevision < 0) {
      throw new Error('expectedRevision must be a non-negative safe integer');
    }

    const reference = loanDocument(db, uid, assetId);
    const changeRef = doc(termsChangesCollection(db, uid, assetId));

    try {
      return await runTransaction(db, async (transaction) => {
        const current = requireExistingLoan(await transaction.get(reference), assetId);
        if (current.revision !== input.expectedRevision) {
          throw staleTermsRevisionError(input.expectedRevision, current.revision);
        }

        // Firestore's client transaction cannot atomically query an unbounded
        // subcollection. Loading the ledger here narrows, but does not close,
        // the race with a concurrent movement write. The parent revision still
        // serializes all terms writers.
        const movements = await listMovements(uid, assetId);
        const preview = calculateLoanTermsChangePreview({
          loan: current,
          movements,
          kind: input.kind,
          changes: input.changes,
          asOfDate: input.asOfDate,
        });
        const timestamp = serverTimestamp();
        const nextRevision = current.revision + 1;
        const audit = serializeTermsChangeForFirestore(
          {
            kind: input.kind,
            before: preview.currentTerms,
            after: preview.proposedTerms,
            reason: input.reason,
            fromRevision: current.revision,
            toRevision: nextRevision,
          },
          { createdAt: timestamp },
        );

        transaction.set(changeRef, audit);
        transaction.update(reference, {
          name: preview.candidateLoan.name,
          startDate: preview.candidateLoan.startDate,
          maturityDate: preview.candidateLoan.maturityDate,
          rate: preview.candidateLoan.rate,
          rateType: preview.candidateLoan.rateType,
          revision: nextRevision,
          latestTermsChangeId: changeRef.id,
          updatedAt: timestamp,
        });

        return {
          changeId: changeRef.id,
          revision: nextRevision,
          ...preview,
        };
      });
    } catch (error) {
      if (error?.code === 'STALE_LOAN_TERMS_REVISION') throw error;

      const latestSnapshot = await getDoc(reference);
      if (latestSnapshot.exists()) {
        const latest = withId(latestSnapshot, deserializeLoanFromFirestore);
        if (latest.revision !== input.expectedRevision) {
          throw staleTermsRevisionError(input.expectedRevision, latest.revision);
        }
      }
      throw error;
    }
  }

  return {
    listLoans,
    getLoan,
    createLoan,
    updateLoanMetadata,
    listMovements,
    listTermsChanges,
    addMovement,
    correctMovement,
    previewLoanTermsChange,
    applyLoanTermsChange,
  };
}
