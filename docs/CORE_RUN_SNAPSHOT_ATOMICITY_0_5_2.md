# 0.5-2 Core Run / Event / required Snapshot atomicity

## Scope and frozen boundaries

No schema/migration, lifecycle/status changes, DeviceSession/Online Policy,
A1, authoring or Presentation ownership changes. Reward, attendance and roll-call
domain transactions remain for 0.5-3; operation policy is not implemented here.

## Transaction contract

`ClassroomSnapshotService.transactionRequired(work)` acquires the existing
snapshot serial gate BEFORE opening the root transaction. `work` receives one
EntityManager. Run CAS, Event, transfer/avatar business records and required
Snapshot all use that manager. Read the break/restore context again through
that manager rather than using a preflight snapshot as the authoritative value.

`captureRequired(runId, reason, isKey, patch, manager)` requires an active
caller transaction manager, uses the manager-taking capture path directly,
does NOT acquire the Promise queue or start a nested transaction, and throws
if snapshot capture returns null. Snapshot insert/trim/failure-log writes in
that transaction are rolled back with the Run/Event on failure.

`captureBestEffort(...)` owns its standalone capture transaction and contains
unexpected capture errors. It must not be called from an active outer business
transaction. Periodic sampling and public observation checkpoints use this
path. Public feedback Run/Event/version behaviour stays compatible: its small
Run/Event transaction commits first; failed observation sampling does not undo
that acknowledgement or terminate the classroom. Both root paths share the
same gate; observation sampling is queued only AFTER its Run/Event transaction.

The legacy `capture(...)` remains available for existing integrations, notably
0.5-3 domain writers. This is NOT a claim that all application transactions
now share a process-global database mutex or that multi-instance deployment
is safe. Core Run controls and snapshot sampling are the scope of this gate.

## Required operations

- changeStep
- startBreak / endBreak / deterministic timeout settlement
- takeover, including ClassroomDeviceTransfer
- recover
- avatar bind/unbind, including binding/history records
- internal control checkpoint
- pause/resume/cancel and complete fallback snapshot use captureRequired

Start/OPENING and normal complete/SUMMARY retain their existing protected
lifecycle writer: the same caller manager is supplied, and a failed lifecycle
snapshot already throws. No lifecycle flow was rewritten.

isKey controls retention, NOT whether a snapshot is required. changeStep remains
isKey=false while its capture is mandatory for business atomicity.

No AI, network, screen ACK or TTS is awaited in the new required transactions.
Classroom complete's existing summary-draft generation remains AFTER the core
transaction, outside this atomicity boundary. No external side-effect rollback
or distributed transaction is claimed.

## Failure injection

SQLite integration matrix covers nine operations (step, break start/end/timeout,
recover, takeover, bind/unbind and control checkpoint) with BOTH late Event and
late Snapshot persistence failures. Faults occur AFTER the actual repository
save, proving rollback of persisted rows, not just pre-write validation.

Before/after compare full Run/Event/Snapshot/Transfer/AvatarBinding/AvatarHistory
rows. Event/Snapshot repositories must use one identical manager with active
transactionDepth=1. Retry the same domain request id, then repeat success: only
one Run version advance and no repeated writes. Refresh restore's step and latest
snapshot Run version must match the stored Run. Timeout uses its deterministic
request id derived from the authoritative current deadline.

CAS affected=0 must leave Run/Event/Snapshot unchanged. Best-effort feedback and
an actually due periodic snapshot are injected with capture failures; Run remains
running. Unit tests also prove required capture does not open another transaction
and rejects a manager with no active transaction.

These retry tests target the core Run/domain entry points. Existing CommandBus
failed-receipt caching and crash reconciliation are unchanged; no new command
receipt retry semantics are claimed.

## Remaining / runtime

Formal process is not restarted by this batch. Browser runtime acceptance is
separate. 2C-1 browser acceptance remains deferred, not sealed. 0.5-3 domain
atomicity and operation policy remain pending. No commit/push.

## Verification 2026-10-15

- Type check / build / diff whitespace check passed.
- Lint passed with the existing unchanged lifecycle-merge spread warning.
- Full backend unit: 21 suites, 156 tests passed.
- Full backend E2E: 22 suites, 232 tests passed.
- New targeted integration matrix: 20 tests passed, including 18 late-write
  failure/retry cases, CAS affected=0 and auxiliary snapshot failure.
- Presentation ownership, A1, authoring, READY/OPENING/TEACHING/PAUSED/SUMMARY
  and restart recovery remain covered by the passing backend regression suite.
- Local JSON reports: .tmp/atomicity-unit.json and .tmp/atomicity-e2e.json.
- No production database changes or runtime restart; no browser acceptance claimed.
