# SUMMARY handoff implementation

## Ownership and recovery

- `ClassroomRun.status` remains the business fact; SUMMARY is presentation metadata only.
- A successfully validated active screen read issues/reuses an opaque, server-memory handoff ID.
- The lease binds teacher, run, device, binding and expiration; only its ID goes into sessionStorage.
- Active reads renew the 30-minute lease. SUMMARY reads do not renew any deadline.
- GET and SSE share screenState. SSE retains the handoff issued to its own active connection.
- No handoff means active Run -> READY -> IDLE, never a completed candidate query.
- With a lease, only its explicit Run ID may be checked for a valid SUMMARY.

## Completion and invalidation

- Normal bound completion writes completed Run, ending Snapshot with summary lifecycle and event in one transaction manager. The protected Snapshot writer writes one ending Snapshot, not two independent commits.
- Durable duplicate complete returns the existing result and does not change revision or expiresAt.
- Transferred/recovery Runs without a valid matching binding can still be ended, but get only an ending Snapshot and no SUMMARY qualification.
- Fresh READY permanently revokes all prior device leases. Cancelling it does not restore them.
- New start revokes old device leases. Cancel/failure, close, expiration, changed binding and cross-day invalidate eligibility.
- Reads recheck lease validity after awaited lifecycle validation, preventing a stale read from surviving READY/start revocation.

## Scope and known boundaries

- Static SUMMARY lasts 20 seconds. No TTS, generated text, extra effects, new Run status, database tables or columns.
- Same-tab refresh retains the lease ID and the original absolute deadline.
- New pages without a lease remain IDLE.
- Process restart discards leases. A completed Run is not used to reissue a lease; the page returns IDLE. Active Runs can establish new leases after normal validation.
- Leases are single-process only. Multi-instance deployment requires a separate design.
- Duplicated tabs may inherit sessionStorage and the same eligibility. This accepted boundary is not strict single-screen-instance enforcement.
- Existing snapshots without lifecycle remain compatible. No migration or backfill occurs.

## Verification

- Backend integration covers atomic rollback, SUMMARY/no-lease IDLE, SSE parity, duplicate complete, READY cancellation non-resurrection, expiry, close, new Run and cancelled/failed exclusion.
- Lease tests cover wrong principal/device, rebinding, restart, tampering and cross-day.
- Frontend tests cover static SUMMARY, cleanup, expiry, late-message suppression and continuing heartbeats.
- Browser verification uses isolated data at 1600x900: associated SUMMARY, same-tab refresh, new page IDLE, no media/TTS requests and teacher close.
