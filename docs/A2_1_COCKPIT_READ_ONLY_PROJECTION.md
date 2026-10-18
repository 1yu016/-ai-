# A2-1 Teacher cockpit read-only projection

## Scope and contract

GET `/classroom-runs/:id/cockpit`, teacher JWT, `schemaVersion: 1`, `Cache-Control: private, no-store`.
Only an owning teacher who retains class/school access may read. Existing 401/403/404 semantics remain. A completed/cancelled/failed Run projects `terminal`; this is a historical teacher view, not proof of student SUMMARY visibility. No IDLE/READY Run is invented.

The response explicitly allowlists Run identity/status/version, class id/name, policy phase and break information, frozen-version title/objectives, frozen runtime current/next steps, presentation control and correlated observation, device evaluation, capabilities, source versions and recovery warnings. Teacher guidance and student content remain separate. The DTO is inferred from the allowlisted service return type.

## Sources and missing facts

- Run: ClassroomRun. Steps: ClassroomRunStepSnapshot, never current LessonStep. Historical plan: exact LessonPlanVersion by plan id/version number; absent/invalid JSON is unavailable, with no live-plan fallback.
- Phase/capabilities: existing readOperationContext/operationPhase/decideOperation/policyAllowedActions. A stale/missing Snapshot for active Run forces recovery. Corrections retain existing policy caveats; executionChecksRequired is always true.
- Presentation: latest checksum-valid, Run-compatible Snapshot. Observation requires the same presentationCommandId/revision and is sanitized with the existing ownership merge whitelist. Control status is not player status.
- Delivery is always `unknown`: no independent device receipt ACK is available. Snapshot saved time is not player event time; observationOccurredAt is null.
- Device: existing online policy and DEVICE_HEARTBEAT_TIMEOUT_SECONDS, evaluatedAt separate from Run version. No device tokens or resource storage paths are returned.
- Resources: runtime resourceId only. Run does not freeze resource version; metadata/authorized previews and finer-grained execution confirmation remain A2-2 work. No resource-version persistence change was made.

## Read-only and race handling

No call to Run.get/restore/screenState, lifecycle settlement, capture, timers, commands, handoff issuance or network AI. PlatformAccessService retains identical access decisions but accepts an opt-in readOnly flag to skip denied-access audit writes; other callers keep the original default auditing behavior.

At most two attempts. Re-read Run, valid Snapshot identity, current binding and class authorization after aggregation. Changed core state retries; persistent changes return 409 `COCKPIT_STATE_CHANGED`. Heartbeat changes are not part of core comparison. A committed but incompatible Snapshot yields recovery warnings rather than made-up playback. Reads are an optimistic point-in-time projection, not a cross-process serializable transaction or a delivery acknowledgement.

## Verification evidence (2026-10-18)

All new HTTP tests use a separate in-memory SQLite DataSource and synthetic records, ignore .env, and do not initialize production AppModule/schedulers. Schema synchronization is used solely to create that isolated in-memory test schema; no migration or formal database is used.

- Full unit: `npm test -- --runInBand`: 26 suites / 562 tests passed.
- Full E2E: `npm run test:e2e -- --runInBand`: 42 suites / 461 tests passed during this batch. Subsequent final binding-comparison/warning adjustments and additional tests are covered by the final targeted rerun, not claimed as another full-suite run.
- Build and type-check passed. Lint exited zero with six warnings in existing files; no warnings in new cockpit files.
- Targeted final counts are recorded in the delivery response after completion. Scenarios cover teacher authentication/ownership/class/school denial, terminal and active phases, immutable steps/version projection, valid/stale feedback, finite races/retry, ordinary heartbeat changes, expired break non-settlement and full-table content equality around GETs. SQLite integrity_check is also asserted.

Earlier test iterations were not all green: the first fixture omitted TEST_TEACHER_NAME (11 setup failures); the feedback fixture initially used a control write which correctly cleared new-command observation (1 failure); a cross-school test initially changed JWT claims rather than the authoritative Teacher loaded by AuthGuard (1 failure). These were fixture corrections, not relaxed assertions or production authorization changes.

## Boundaries and handoff

No frontend, schema, DeviceSession, Online Policy, A1, authoring, canonical transactions or lifecycle changes. Existing dirty worktree changes remain. No formal service restart, deployment, browser acceptance or B integration. B must consume allowedActions as hints, refresh with actual Run version, keep preview read-only and distinguish command control, unknown receipt and reported player observation.

A2-2 should address authorized resource metadata/preview and precise existing feedback semantics, without assuming playback ACK or changing resource version persistence implicitly. Stop after A2-1.
