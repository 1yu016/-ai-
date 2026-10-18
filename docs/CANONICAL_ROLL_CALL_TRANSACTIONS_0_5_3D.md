# 0.5-3D Canonical roll-call transaction contract

## Scope and ownership

ClassroomRollCallService is the only writer for the current formal CommandBus
random/specified/group roll-call operations. ClassroomRollCallRecord is the formal
fact; rollCallState is a rebuildable projection, not a second selection log.
Legacy participation/voice/random-group adapters remain for 3E. No frontend,
Run lifecycle/status, Snapshot model, DeviceSession, Online Policy, A1 or authoring
changes. No new tables/columns/migrations. Existing group entities are registered
in ClassroomRunModule for READ access; no group creation/update code is changed.

## Atomic flow

Authorization -> durable receipt -> Run CAS -> candidate verification -> first
selection -> ClassroomRollCallRecord -> roll_call receipt Event -> required
Snapshot -> commit. The projection is computed after reading the newly persisted
formal record and before writing its receipt, all in the same transaction.

Reuse transactionRequired and captureRequired(manager). All repository calls use
the same manager/transaction; no queue re-entry, nested transaction or external
AI/network/ACK/TTS wait occurs. Failure rolls back CAS, result, receipt and Snapshot.
CommandBus no longer writes an additional result/Event/checkpoint.

## Candidate rules: first execution only

- Teacher owns Run and currently has TeacherClass/school access.
- Run is non-terminal and expectedVersion (if supplied) matches; CAS checks owner,
  version and status. This batch does not introduce the 0.5-4 phase policy.
- Read current-class active Student rows inside the transaction. Formal
  StudentAttendanceRecord absent/leave excludes candidates; late/present/unmarked
  remain eligible, preserving the existing formal policy.
- Optional studentIds is a sorted, nonempty, unique ID range. Foreign/inactive
  explicitly supplied range members reject the operation, not silently widen it.
- Optional groupId must identify a non-deleted StudentGroup of this Run/class.
  Read active StudentGroupMember rows with removedAt=null, intersect current eligible
  students and optional range. membershipSnapshot is NOT used for authority.
- group_random accepts groupId or the existing explicit studentIds range. groupKey
  without groupId is only the legacy-compatible display label, never proof of
  membership/permission. No groupKey-to-name guessing is introduced.
- Specified ID must identify exactly one eligible child. Name compatibility rejects
  ambiguity and ID/name mismatch. Specified selection does not call the RNG.
- Random/group selection uses all formal Run history for minimum-count fairness.
  cooldownCount defaults to 1 (existing formal path's immediate-repeat avoidance),
  accepts 0..50, excludes recent N results within the fair pool if possible. If no
  fair alternative exists, relax cooldown and persist cooldownRelaxed in the first
  receipt result. Specified teacher selection intentionally bypasses soft cooldown.
- algorithmVersion defaults to fair-v1. New unsupported versions reject. On an
  existing request, a different version conflicts before any selection occurs.

## Receipt, randomness and replay

Strict kind=classroom_business_receipt + contractVersion=1 + normalizationVersion=1.
roll_call.random / roll_call.specified / roll_call.group_random require RollCall
Event type; ordinary old RollCall Events do not qualify. Reward/attendance receipt
recognition remains unchanged. Committed receipt result/digest/record IDs are immutable.

Digest covers mode, specified ID/name, sorted studentIds, groupId/groupKey,
cooldownCount, algorithmVersion and runId. It never includes volatile current
membership/candidate contents. Same business request after student/group changes
returns the frozen first child, display name, recordId and original projection.
Replay rechecks current teacher/Run access, but not candidate pool or random source.
Completed/cancelled/failed Runs allow authorized successful replay only, no new calls.

Random index comes from node:crypto.randomInt inside the transaction. A rolled-back
draw is not a committed fact and a retry may draw again. A committed draw never
draws again, including after lost response or concurrent identical requests. Formal
legacy records without a verifiable receipt reject as LEGACY_REQUEST_UNVERIFIABLE,
not guessed into a first result.

CommandBus normalizes roll-call business parameters for order-independent range
retries. Its existing strict transport envelope (including expectedVersion) still
applies; transport retries retain that envelope. Exact pre-3D transport hashes can
replay the old cached response, without synthesizing a canonical receipt. Failure
cache/processing/crash reconciliation remains the known 3B/3C boundary.

## Projection rebuild

Read ALL formal Run records ordered createdAt DESC, id DESC, without the old 50-row
count limit. Rebuild counts, unique recentStudentIds, recentResults, lastRecordId,
lastStudentId/display name, operation and updatedAt. New timestamps preserve ms and
do not precede existing formal Run history. No previous Snapshot value seeds counts,
cooldown, fairness or the selected child. Snapshot-only fake history is discarded by
the next canonical operation. Unrelated protected lifecycle/control state is preserved
by the existing Snapshot writer contract.

## Tests and limitations

Isolated DB tests cover random/specified/group, lost response, candidate reads never
occurring on replay, changed membership/deleted groups, in-transaction candidate
changes, absent/leave/disabled/transfer/foreign students, digest conflicts, cooldown
relaxation, ambiguous names, CAS/terminal/authorization, concurrent retries, legacy
facts, corrupted and Snapshot-only history and more than 50 formal rows.

Record/Event/Snapshot fault injection throws AFTER real save; all DB rows compare
equal after rollback. Same-manager/depth=1 assertions are included. Retried failed
draw may select a different child; subsequent committed retries return that child.
HTTP CommandBus tests assert one version increment/one receipt, zero extra checkpoint,
sorted range replay, changed parameter conflicts, specified selection, terminal and
current authorization behavior. The HTTP workflow retains the default test budget.
Initial full regressions exposed real model requests from pre-existing fake-key
summary test fixtures during complete. Main/legacy/recovery fixtures now explicitly
disable summary model calls (same safe-rules path used by record tests); temporary
timing instrumentation and the diagnostic timeout override were removed. No
production AI, complete, timeout or lifecycle code changed. Real model availability
is not claimed by this batch's isolated regression.

No formal backend restart/browser acceptance in this batch. Production data is not
edited. 2C-1 browser acceptance is still deferred, not sealed. No 3E or 0.5-4 work,
no commit/push. Old participation/voice histories are neither merged nor migrated.

## Changed files

- backend/src/classroom-runs/classroom-roll-call.service.ts (new canonical service)
- backend/src/classroom-runs/classroom-command.service.ts (delegate and replay/hash)
- backend/src/classroom-runs/classroom-run.module.ts (service and existing group metadata)
- backend/src/classroom-runs/classroom-business-receipt.service.ts (roll-call envelope types)
- backend/src/classroom-runs/classroom-business-receipt.service.spec.ts
- backend/test/roll-call-canonical.e2e-spec.ts
- backend/test/classroom-run.e2e-spec.ts (HTTP regression and isolated summary config)
- backend/test/classroom-run-legacy.e2e-spec.ts (isolated summary config only)
- backend/test/classroom-recovery.e2e-spec.ts (isolated summary config only)
- This report. Other dirty worktree changes are preserved.

## Final verification

- Build/type-check/lint passed; lint retains one pre-existing Snapshot spread warning.
- Full unit suite: 22 suites / 162 tests passed, 0 failed.
- Full E2E suite: 24 suites / 289 tests passed, 0 failed (57.349s).
- Dedicated canonical roll-call suite: 16 passed; main classroom suite: 76 passed.
- 0.5-1, 0.5-2, rewards 3B, attendance 3C, A1 and lifecycle automated regressions passed.
- git diff --check passed; no production schema/data changes or service restart.
- Existing production complete still awaits summary draft generation outside its
  Run transaction. Real-model latency/availability is a separate runtime boundary;
  no lifecycle or summary production behavior was changed to address it here.
