# A1: experience candidate backend contract

## Acceptance status

A0 backend acceptance remains valid. 2C-1 browser acceptance is deferred,
not completed or sealed. It must pass before formal A1/B integration.
No frontend, authoring save path, classroom lifecycle or database schema changes.

## API

Reuse POST /lesson-plans/ai-drafts and GET /lesson-plans/ai-drafts/:id.
Send schemaVersion=2, taskType=experience_optimization, baseLessonPlanId,
baseVersion, targetStepId and 1-5 unique referenceRunIds, together with the
existing theme/age/domain/objectives/duration/resourceIds fields.
Only same-plan, completed, currently accessible teacher-owned runs qualify.
Client safeFacts/sourceReferences are not accepted.
The current target step must belong to the exact base version. Historical
steps are never matched to current steps by name or position.

## Immutable evidence contract

Existing evidence-pack digest is evidenceDigest; ruleVersion identifies the
projection rules. sourceReferences holds only whitelisted event facts and
run/version identifiers, not raw payload or the full evidence pack.
evidenceId uses persisted event primary key `event:<id>`, never model-generated
IDs or positional indexes. Under one evidenceDigest the stored mapping is
fixed. Changes to evidence produce a different digest. Candidate evidenceIds
must be a nonempty subset of this mapping.

Output/input JSON retain evidenceDigest, ruleVersion, referenceRunIds,
sourceLessonVersions, sourceReferences and limitations. GET returns the same
stored output; it does not regenerate evidence or call AI.

The minimal **future formal version provenance** contract is frozen as
ExperienceProvenanceV1 in lesson-experience.contract.ts:

- contractVersion=1
- draftId and candidateId
- evidenceDigest
- referenceRunIds
- sourceLessonVersions: runId, lessonPlanId, versionNo, versionId,
  snapshotDigest (nullable for missing historical versions)

POST returns provenanceSources with this shape. On reload it is deterministically
reconstructible from the Draft id, candidateId and stored output metadata.
It is NOT sufficient for future formal provenance to persist only draftId.
This batch does not change authoring: the existing aiProvenance format is
unchanged and does not yet persist these evidence fields in a formal version.
A future approved adoption integration must derive this minimal envelope on
the server, never trust client-supplied provenance, and persist it alongside
the existing field-level decisions. No full pack duplication.

## Concurrency and failures

After model completion, recheck current LessonPlan.version/currentVersionId
against the requested base version, then rebuild evidence and compare digest.
A changed current version or evidence returns conflict, not a usable Draft.
No long-running database transaction is held during the model request.
This is not a reservation against a subsequent edit: later authoring still
requires its existing base-version conflict check.

AI failures return a service-unavailable response and at most a failed Draft;
no formal lesson or classroom writes. Logs contain stage/code/timing, never
the full prompt or model output.

## Privacy and interpretation

Only safeFacts goes from the evidence pack to AI. teacherReview, confirmed
summary prose and sourceManifest never enter the model prompt. Existing
teacher/resource free text receives an additional risk check, not a claim of
complete anonymisation. No inference of engagement, ability or effectiveness
from execution counts, pauses or elapsed time is permitted. Text heuristics
cannot prove semantic correctness; teacher review remains mandatory.

## Test and runtime boundary

Unit tests cover valid provenance, forged evidence, effectiveness claims,
concurrent version changes, permissions and timeout. SQLite HTTP integration
compares all rows of Plan/Step/Version/Run/Summary/Snapshot/Event before and
after generation/read/forbidden confirmation. 2C-1 privacy tests are retained.
Real provider acceptance and formal runtime reload must be reported separately;
mocked model success is not real-model acceptance. Do not restart an active
classroom or silently load an unverified build.

## 2026-10-15 execution evidence

- Backend build/type check passed. Lint exited successfully with one existing
  warning in classroom-snapshot.service.ts (unchanged by A1).
- Full backend E2E: 22 suites / 211 tests passed, including new real SQLite
  HTTP candidate generation and the existing lifecycle/READY/OPENING/SUMMARY tests.
- Final full unit run: 20 suites / 149 tests passed, including seven new
  experience boundary tests.
- Real provider call passed on network-enabled retry. The first restricted
  run timed out and produced only a failed Draft in a separate isolated copy.
- Successful real run used a SQLite online-backup copy and synthetic current
  authoring text, with server-projected safe facts from run 66. No child free
  text, original summary or raw event payload was supplied to the provider.
- Success report: `.tmp/a1-real-auxIHl/report.json` (ignored local artifact).
  Draft id 1, one candidate, evidenceDigest
  `46c899f91480084a1c30d35f323e75e87fd17419bb5f9d890a0120c37a824552`.
- Before/after counts and SHA256 were identical for lesson_plan (8),
  lesson_step (29), lesson_plan_version (37), classroom_run (66),
  classroom_summary (0), classroom_snapshot (878), classroom_event (253).
  These are isolated-copy comparisons, not a claim that all database tables
  remained unchanged: Draft/audit inserts are expected.
- No formal backend restart, browser acceptance, commit or push performed.
  Formal runtime loading remains a separate step. Do not declare 2C-1 sealed.
