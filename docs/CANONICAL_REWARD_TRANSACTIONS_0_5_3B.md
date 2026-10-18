# 0.5-3B Canonical reward transaction contract

## Scope

Personal award/revoke, collective award/revoke and the current formal CommandBus
reward/revoke routes only. No attendance, roll-call, legacy engagement/participation,
legacy voice, Operation Policy, frontend, lifecycle, DeviceSession, Online Policy,
A1, authoring or database schema changes. Existing dirty worktree is preserved.

## Canonical flow

StudentRewardService uses the frozen Snapshot transaction gate. Inside one manager:
teacher/Run/class/school access -> receipt lookup -> terminal/version checks ->
Run CAS -> canonical record/revocation + growth projection -> deterministic reward
projection -> immutable business Event receipt -> captureRequired(manager).
Any late failure rolls everything back, including the receipt and any snapshot
failure audit row written in the same transaction. No external calls are awaited.

First execution checks active/current-class student membership. Revoke locates the
original canonical record by recordId AND runId; later student disable/transfer
does not prevent revoke. First writes/revokes on a terminal Run are rejected;
authorised existing success receipts replay without writes. Current class access
is checked before replay, including formal CommandBus cached reward receipts.

## Receipt contract

ClassroomBusinessReceiptService is the sole new internal reader/writer.
Only eventType=command/result=success with an exact envelope is accepted:

- kind=classroom_business_receipt; contractVersion=1; normalizationVersion=1
- originalRequestId; operation; runId; payloadDigest
- businessRecordIds; committedRunVersion; frozen result

Only the four reward operation identifiers are accepted in this batch. Unknown
fields/versions, malformed identifiers or ordinary command events cannot replay.
The writer requires an active manager and INSERTs only; an existing key cannot
be overwritten, including its result/digest/record list. No public receipt writer.

Event.requestId is fact-v1:SHA256(JSON([actorType,actorId,runId,originalRequestId])).
Operation is NOT in that key, so reusing the same Run/requestId for another reward
operation conflicts. Existing canonical table unique constraints are preserved.

Digest: SHA256 of recursively key-sorted JSON containing normalizationVersion,
runId, operation and validated/defaulted business payload. Reward forms are sorted;
duplicates rejected; reasons trimmed; null/default policy is explicit. Transport
version is a precondition, not part of the domain digest. Existing success replays
the persisted first result. A later cumulative total/revocation does not mutate it.
No in-memory receipt cache. Old canonical create records without a verifiable
receipt conflict as LEGACY_REQUEST_UNVERIFIABLE instead of executing again.

These Events must be retained while their formal facts remain; no pruning or
retention migration is introduced. No cryptographic/database-admin tamper-proof
guarantee is claimed: immutability is enforced by the application writer contract.

## Projection rebuild

rewardState is rebuilt from all canonical personal rows for this Run, adding
stars ONLY for non-revoked rows; revoked-only students retain a zero entry.
No previous Snapshot value is used as an accumulator. Collective rewards remain
one class record, with separate interactionState.collectiveRewardState projection.
Existing presentation hints are validated/rebuilt from canonical active records;
revoked/invalid hints are removed. ScreenLifecycle ownership is untouched.

Growth goal cached values are also recomputed from canonical personal/collective
records: personal and unassigned collective facts use goal creation windows;
explicit collective goalId stays associated with that goal. Archived goals stay
archived; a corrected prior goal never becomes a second current active target.
New timestamps retain milliseconds; new goal boundaries are strictly after prior
canonical reward timestamps, avoiding SQLite datetime() second-boundary loss.
No legacy engagement reward/growth tables are merged or migrated.

## API compatibility

Existing URLs and record IDs are kept. Create/revoke DTOs optionally accept
version. Without it the server uses the current version for CAS; this is not
client stale-intent protection. Every first mutation increments Run.version once.
Results add committedRunVersion; retries return the original committed result.
Callers must not mistake replayed rewardState for current cumulative state.
Current state can be read via the existing Run/history APIs. No frontend edits.

Formal CommandBus passes expectedVersion to the canonical service and does not
append another rewardState checkpoint. Its existing transport requestHash, failure
cache and processing/crash-reconciliation behaviour are not redesigned. Transport
retries should retain the original command envelope. Domain receipts are separate
from command transport acknowledgements and do not prove physical display delivery.

## Tests

Late-write matrix: four operations x record/Event/Snapshot/goal failures. Faults
occur AFTER actual repository save. Full Run/personal/collective/goal/Event/Snapshot
rows are compared before/after rollback; manager identity and transactionDepth=1
are asserted. Same request retries once and subsequent repeats make no writes.

Additional tests: lost response/frozen replay, changed business fields/conflicts,
same ID across operation conflict, corrupted and valid-but-wrong Snapshot rebuild,
revoke/history/goal/presentation consistency, disabled/transfer handling, stale and
affected=0 CAS, terminal/replay permissions, collective non-expansion and correction
of a prior goal. Unit tests reject normal command events and committed overwrite.
Formal CommandBus test asserts one Run increment, no checkpointControl call,
one official award, cached replay and rechecked class access.

### Final verification

- Backend build, typecheck and lint passed. Lint retains one pre-existing
  no-useless-fallback-in-spread warning in classroom-snapshot.service.ts.
- Full unit regression: 22 suites, 160 tests passed, 0 failed.
- Full E2E regression: 22 suites, 257 tests passed, 0 failed.
- Canonical reward suite: 44 tests passed, including the late-write matrix.
- Formal CommandBus delegation regression passed within the full E2E run.
- git diff --check passed. Injected failure logs are expected test evidence.
- Verification uses isolated test databases; formal runtime was not restarted.

## Remaining

No formal service restart or browser acceptance. 2C-1 browser acceptance remains
deferred, not sealed. Legacy modules and voice still have their old paths until
3E; this batch is NOT a claim of global single-source convergence. 3C/3D and
Operation Policy remain untouched. No commit/push.
