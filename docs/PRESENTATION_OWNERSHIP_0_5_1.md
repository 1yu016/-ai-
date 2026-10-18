# 0.5-1 Presentation ownership contract

Scope: backend write ownership only. No schema migration, lifecycle change,
transaction redesign, phase operation matrix, reward or attendance domain changes.
A1 contract stays frozen. No formal runtime restart is performed.

## Server control

The HTTP controller still calls `checkpoint()` at the same checkpoints URL.
That path only supplies `playerObservation` to Snapshot capture. Body fields,
including checkpointType=command, cannot select the internal control path.
Attendance/reward/roll-call/interaction objects remain accepted for legacy
request-shape compatibility, but cannot be written through this HTTP path.
ScreenLifecycle protection is unchanged.

Internal command writers call `checkpointControl()` instead. This is a
TypeScript service method, NOT an HTTP endpoint; it retains existing permission,
version and classroom checks. CommandBus and legacy voice call-site changes are
ownership routing only, not changes to rewards, attendance or command execution.

Server playerState owns presentationMode, presentationCommandId,
presentationItemId, resource/artwork identity, operation, target device, autoPlay,
volume/mute/zoom and return points. Ordinary feedback cannot replace any of them.

## Observation

The playerState feedback envelope must echo BOTH:

- presentationCommandId: exact current server command identity
- presentationRevision: exact server-minted revision

A new server presentation command is stamped with the current Run version.
Progress samples do not mint a new presentation revision. A different command
for the same resource is still a different presentation. Run version and
presentation revision are separate concurrency checks.

Allowed feedback: finite non-negative currentTime/duration; positive integer
pageIndex/pageCount; boolean completed; bounded enum status; structured errorCode matching
`[a-zA-Z0-9_-]{1,64}`. No raw exception text or media URLs are persisted.
Observation status/errorCode are stored under playerState.observation, never
overwriting control status. Timing/page fields additionally retain flat aliases
for existing restore consumers. The nested observation includes its correlation.
Correlated completed=true feedback marks only the server-selected current
resource as played, and only in resource mode. Client resourceId is not the
authority. Stale completion feedback cannot mark a newer presentation played.

Snapshot merges feedback against the latest valid snapshot inside its EXISTING
serialised capture transaction, not a stale pre-read in the HTTP controller.
Stale/missing correlation means feedback is ignored, not rebound by resourceId.
Existing checkpoint Run/Event/version behaviour is intentionally unchanged;
this batch does not claim no-op feedback avoids version/event writes.

## Legacy compatibility

Full legacy playerState objects are filtered, not trusted. Clients that echo
both association fields retain permitted feedback writes; clients without
them remain able to read but cannot update observations. Member B must add
presentationRevision to the frontend typed feedback contract during integration.

Historical nonempty playerState without valid command/revision is still decoded
and checksum-verified, but its read projection forces autoPlay=false. No database
backfill or guessed identity. Stored historical rows are not rewritten.

No new frontend rendering or error UI is included. Consumers may later read
playerState.observation.status/errorCode; those are observations, not commands.

## Tests and pending scope

Unit tests: whitelist, immutable controls, same-resource A/B late feedback,
missing/wrong correlation, malformed values, server revision, legacy read safety.
Real SQLite/HTTP test: command-type spoofing cannot change mode/command/item/
return point/rewards/interaction/screenLifecycle; matching time/page/error feedback
works; stale A, missing association and wrong revision cannot replace B.
Existing restore fixtures now establish controls on the server rather than
using the newly prohibited public control-write behaviour.

0.5-2 Run/Event/Snapshot atomicity, operation matrix and command receipt crash
reconciliation remain explicitly out of scope. Full backend regression is
required before acceptance; build artifacts alone do not load the formal process.

## Verification 2026-10-15

- Type check and build passed.
- Unit: 21 suites, 154 tests passed.
- Full E2E: 22 suites, 212 tests passed (including lifecycle, legacy restore,
  restart recovery, READY, OPENING, SUMMARY and A1).
- Lint and diff whitespace check passed; one existing Snapshot spread warning
  remains in the unchanged lifecycle merge expression.
- Local machine-readable reports: .tmp/ownership-unit.json and
  .tmp/ownership-e2e.json. Formal runtime was not restarted or browser-accepted.
- Existing A1 and frontend worktree changes were preserved, not overwritten.
- No commit/push. 0.5-2 and phase policy remain unimplemented.
