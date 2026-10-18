# 0.5-3C Canonical attendance transaction contract

## Scope

Only the new AttendanceService write path and current CommandBus attendance_update
entry are changed. No frontend, lifecycle, DeviceSession, Online Policy, A1,
authoring, roll-call, legacy participation or legacy voice-confirm adaptation.
No entity/schema/migration changes. Formal service is not restarted.

## Canonical state and transaction

StudentAttendanceRecord is the only current attendance status source (unique
run/student). StudentAttendanceChange is append-only change audit, never a second
current state. Snapshot attendanceState is a recovery projection only. The summary
aggregate's current attendance counts also read AttendanceRecord, not Change audit;
the historical timeline still uses Change. Existing saved summaries are unchanged.

Both single and batch use AttendanceService.apply:

authorization -> durable receipt lookup -> Run version/status CAS -> current
student/class validation -> AttendanceRecord -> AttendanceChange -> canonical
record read/projection -> Attendance Event receipt -> captureRequired(manager)
-> commit.

Record reads used to build the result occur before Event insertion; the required
Snapshot write occurs after the Event. Every read/write uses the caller's same
EntityManager inside the existing transactionRequired gate. No nested transaction,
Snapshot queue re-entry, network/AI/ACK/TTS waits. A batch increments Run.version
once, not once per student. All affected facts and the receipt roll back together.

New writes check teacher ownership, current TeacherClass authorization, school,
Run non-terminal status/version and each student's active/current-class status.
The caller's classId is not trusted. Authorized successful replay precedes terminal,
version and current student checks; it never writes or settles timed breaks.

## Durable receipt and digest

Reuse ClassroomBusinessReceiptService and the existing ClassroomEvent uniqueness
key. Exact kind=classroom_business_receipt, contractVersion=1 and normalizationVersion=1
remain mandatory. New operations attendance.single / attendance.batch require
eventType=Attendance; reward operations retain eventType=Command unchanged.
Ordinary attendance or command Events do not qualify as receipts.

The digest includes runId, operation, sorted studentId/status/note tuples, source
and confirmation semantics. Notes are trimmed (empty/omitted -> null), capped at
500 characters. Duplicate studentId is rejected, even with identical status.
Array order does not matter. Single and batch are distinct even for one student.
Explicit voice_confirmed=false is rejected; existing voice_confirmed semantics
remain teacher-confirmed without creating a new voice flow.

Notes are retained in immutable receipt result.updates, not new Record columns.
Current attendance GET continues to return canonical status records; it does NOT
promise a new current-note model/UI. Record IDs are businessRecordIds; Change rows
remain linked via run/student/requestId. Receipts must not be pruned independently
of the facts they protect.

Same ID/digest returns the frozen first result, including committedRunVersion,
even after later changes/completion. Different status/note/members/mode/source/
confirmation conflict with 409. Existing Record/Change history is not migrated or
guessed into receipts. If the same run/requestId already has legacy audit rows but
no verifiable receipt, a new mutation fails with LEGACY_REQUEST_UNVERIFIABLE/409.

## CommandBus integration and compatibility

Existing URL/envelope and attendance read/candidate APIs remain. The command parser
normalizes attendance parameters using AttendanceService's same policy, so sorted
batch retries work at both transport and domain layers. Missing optional fields
retain compatible defaults. Unknown sources and malformed updates are rejected.
CommandBus delegates once, passing expectedVersion, and writes no extra attendance
checkpoint or attendance Event. Response retains items/attendanceState/updates,
adding normalized notes/source/confirmed and committedRunVersion.

Cached attendance transport replies re-check current class authorization. Exact
pre-3C command envelope hashes remain replayable as old transport replies; they
do not create/synthesize canonical receipts or re-execute old facts. Reordered
pre-3C envelopes are not guaranteed replayable. Transport failure/processing cache
and crash reconciliation are not redesigned (same known boundary as 3B).

## Projection rebuild

After mutations, all StudentAttendanceRecord rows for the Run are read in stable
student order; attendanceState is replaced from those rows, never patched from
old Snapshot. A corrupt/latest wrong Snapshot cannot invent or retain attendance
entries. Required Snapshot preserves unrelated protected lifecycle/control state
using the frozen 0.5-1/0.5-2 machinery. Existing RollCall snapshot reason is reused
for compatibility, without changing the roll-call write path.

## Tests

- Dedicated isolated in-memory attendance suite: single modification, batch,
  preserved first mark, frozen replay, reordered batch, changed fields/conflicts,
  duplicate student rejection, disabled/transfer/authorization checks, terminal
  and CAS rejection, concurrent retries and terminal-transition race.
- Record/Change/Event/Snapshot fault injection throws AFTER real save, including
  the second student's Record/Change. Full database rows compare equal after
  rollback. Same request retry succeeds once. Assertions check manager identity,
  active transaction and depth=1.
- Corrupt and valid-but-wrong Snapshot rebuild from formal records.
- Real HTTP CommandBus test: one version increment, one attendance receipt,
  no checkpointControl, sorted replay/conflict, terminal replay and current access.
- Receipt unit test: operation-specific Event type and strict envelope recognition.
- A contradictory audit-trail fixture verifies summary counts still follow Record.

## Modified files

- backend/src/classroom-runs/attendance.service.ts
- backend/src/classroom-runs/classroom-command.service.ts (attendance routing/hash/replay only)
- backend/src/classroom-runs/classroom-business-receipt.service.ts (add attendance operations)
- backend/src/classroom-runs/classroom-record.service.ts (current attendance aggregation only)
- backend/src/classroom-runs/classroom-business-receipt.service.spec.ts
- backend/test/attendance-canonical.e2e-spec.ts
- backend/test/classroom-run.e2e-spec.ts (HTTP coverage and fixture isolation)
- This report. Existing unrelated dirty changes are preserved.

## Final verification

- Build and type-check passed; lint passed with one pre-existing Snapshot spread warning.
- Full unit regression: 22 suites / 161 tests passed, 0 failed.
- Final full E2E regression: 23 suites / 272 tests passed, 0 failed.
- Dedicated attendance tests: 14 passed. Main classroom suite: 75 passed.
- git diff --check passed.
- Earlier regression runs exposed test-fixture contamination of the random
  roll-call candidate pool; both added attendance and existing 3B reward test
  students are now disabled in fixture cleanup. No roll-call production changes.
- Legacy transport-hash test uses the real DTO shape, including undefined optional
  fields, matching the old server's hash algorithm. Final regression is green.

## Remaining and runtime boundary

Formal deployment/browser acceptance is separate. No production data was edited.
Legacy participation attendance and old voice-confirm adapters remain for 3E; this
is not global attendance-source convergence. 3D and 0.5-4 are not entered. 2C-1
browser acceptance remains deferred, not sealed. No commit/push.
