# I-2-1 CommandBus recovery success response adaptation

Date: 2026-10-19 (Asia/Singapore). Repository: `D:\trae_project\new1\integration-I1`, branch `integration/i1-ab`, base `368cf69844776e06ffba2a13973141e9dfb266f0`. No commit or push in this batch.

## Root cause and actual backend contract

Normal success from ClassroomCommandService.executeSerialized returns the original execution `result` and full `classroomState` produced by Run.get(). Post-commit recovery returns immutable `receipt.result`, `classroomState: null`, a plain optional `currentClassroomState`, and `recovery: { source: canonical_business_receipt, contractVersion: 1, committedRunVersion, refreshRequired: true }`.

The frontend type previously required non-null classroomState, and lessonRun.command always called adoptRun(classroomState). The direct random-roll-call consumer also accessed classroomState.version without checking null. A successful committed operation could therefore be presented as failed before the current state was refreshed.

## Changed

- classroomCommandBus.ts: represent the real nullable state/recovery metadata, preserving the original envelope/requestId/result and existing legacy full-DTO normalization.
- lessonRun.ts: central applyCommandResult, lastCommandResult, local query synchronization status and query-only retry. Normal success adopts its full DTO synchronously without extra GET. Strict recognized recovery uses existing GET /classroom-runs/:id, not currentClassroomState or a new cockpit endpoint. Refresh errors are caught separately and never reject the committed command promise. No write retry is added.
- LessonClassroomView.vue: dedicated status message and query-only retry button; synchronization errors do not set the main classroom/business failure error.
- useClassroomInteraction.ts: use the same result handler, resolve the component's own Store during setup, and publish the first committed selected student independently of refresh completion.
- New command-recovery-response.spec.ts: 12 tests. Fullscreen interaction component gains two tests, retaining existing assertions. Existing chat-break fixture now models actual monotonic Run version 2 -> 3 on endBreak instead of resetting to 1; no assertion or production guard was relaxed.

## Result, synchronization and race guarantees

`command()` returns the original server result envelope unchanged; `lastCommandResult` retains that response separately from the current Run. It does not fill classroomState with a newer query result. A normal full DTO older than the already adopted version cannot roll back Store state.

Only recognized contract-v1 recovery requiring refresh starts the GET. The response must match run/device, include steps, and reach committedRunVersion. Refresh sequence, state adoption epoch, run/device checks and monotonic Run version prevent an earlier refresh, cleared/replaced classroom or pre-recovery polling response from overwriting a later state. Existing polling cadence is unchanged; only its in-flight adoption is guarded.

On GET failure, the write remains confirmed, the old Store projection remains visible with an explicit stale-state warning, the original result is retained, and retry performs GET only. The status is local query synchronization, not a new classroom lifecycle/state machine. Clearing/changing classroom clears local response metadata to avoid cross-classroom display leakage.

This frontend batch verifies POST/GET counts and result semantics with faithful backend envelopes; it does not re-prove database receipt atomicity. Existing GET may perform its pre-existing timed-break settlement; no claim is made that that backend endpoint is side-effect-free. No backend implementation was changed.

## Actual test evidence

- Before fix: new suite 2 passed / 9 failed, with null adoptRun errors; five unhandled rejections from failing race scenarios were retained in i2-1-before.log.
- First targeted post-fix iteration: 92 passed / 1 failed. Unnecessary asynchronous waiting on a normal result changed fullscreen selection timing. Normal result handling was made synchronous, preserving existing behavior; 93 then passed.
- UI warning/query-only retry coverage: 94 targeted tests passed at that iteration.
- First full run after additional cases: 661 passed / 2 failed. One fixture incorrectly reset Run version after endBreak; one component deferred the committed selected student until after a read refresh. The fixture was corrected to version 3, and committed selection now emits before waiting for state synchronization. Failure logs remain in the adjacent evidence directory.
- Final focused regression: 3 files / 31 tests passed, 0 failed, 0 skipped.
- Final complete frontend unit/component run: 87 files / 663 tests passed, 0 failed, 0 skipped. `npm test -- --pool=vmThreads --maxWorkers=1`.
- Final `npm run type-check`, non-fixing `node node_modules/eslint/bin/eslint.js .`, and `npm run build-only` passed. Build retains the large-chunk warning; component environment reports missing canvas support. No full browser E2E or backend suite was run in this batch.

Evidence: `D:\trae_project\new1\integration-I1-evidence\i2-1-*` logs, including before/failed/final iterations. Historical I1 logs are not presented as this batch's results.

## Boundaries and remaining risks

No backend, canonical transaction, durable receipt, schema, Operation Policy, player identity, allowedActions, voice phase rules, A1, authoring, DeviceSession or formal service/database changes. Original A and I0 were rechecked: 1,320 original/restored protected paths and 1,331 backup artifacts match; original HEAD/index/status unchanged. Read-only verification logs live outside the original workspace and backup.

Browser/network integration and prolonged connectivity failure remain unverified. A later explicit classroom action is still a new command; users must use the query-only retry control after a confirmed success. Next recommendation: event-origin presentationCommandId + presentationRevision feedback adaptation, separately scoped and authorized. Stop after I-2-1.
