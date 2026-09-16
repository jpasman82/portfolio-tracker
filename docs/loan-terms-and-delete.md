# Loan terms and movement deletion

Loan term edits are persisted as one atomic parent update plus one append-only
`termsChanges` audit document. The parent `revision` serializes competing term
edits, and a stale `expectedRevision` is rejected. Audit snapshots include the
mutable terms and the immutable currency, capitalization frequency, and
calculation version; they never include calculated balances or projections.

The browser Firestore SDK cannot query an unbounded movements subcollection as
part of the same transaction that updates the parent loan. The repository loads
and validates the full ledger as late as possible inside the transaction
callback, but a movement write can still race that read. Closing that window
would require a broader ledger revision protocol across every movement write,
which is deliberately outside L3E. The parent revision fully protects
term-edit-versus-term-edit races only.

Deleting a movement is an append-only neutralization: the repository creates
one opposite movement with the same date and amount and a
`reversesMovementId`. A deterministic `void-{movementId}` document ID prevents
two ordinary delete calls from committing two delete reversals. Firestore Rules
keep all movement documents physically immutable. Rules cannot prove that an
arbitrary hostile client created the unique semantically correct reversal, so
the deterministic-ID and full-ledger guarantees belong to the normal
repository path, not to an untrusted direct writer.

Changing `startDate` never moves movements automatically. A loan needs at least
one effective contribution inside its contractual period, but that contribution
may occur after `startDate`; value and interest remain zero until it occurs.
Financial validation derives from effective movements, while originals and
technical reversals remain physically available for audit. A later `startDate`
is rejected while any effective movement precedes it, so the supported workflow
is to correct or neutralize those movements first and apply the audited terms
change separately.
