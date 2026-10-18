# I-1 Independent A/B integration

Date: 2026-10-19 (Asia/Singapore). This is a source integration baseline, not joint/production acceptance.

## Inputs and repository

- Original A (read-only): `D:\trae_project\new1\-ai-`, feature/member-a, `09b99a81d909df6001aa0b204b3efca8eba3bba1`.
- I0 backup and recovery verification: `D:\member-a-recovery\I0-20261018-234844-09b99a8` (read-only).
- Integration repository: `D:\trae_project\new1\integration-I1`, branch `integration/i1-ab`.
- Evidence directory: `D:\trae_project\new1\integration-I1-evidence`.
- A local baseline: `ee59532d7fb12a817888b330cea3978a16662a00`.
- B fixed parent: `7471e33f9ab5c599a3733fb4db7a7afc15eb3716`; includes `513d8a8`.
- Common ancestor of original inputs: `bca825ed94b38cb716f00c05365d7bed6f9aa0a4`.

History was imported from the verified local bundle into a separate Git object store; no network or original-repository Git writes were used. Restored working bytes came from I0, not a blind copy of the current source directory. Dependencies were explicitly copied into separate ignored node_modules directories for local validation, not committed or junction-linked to A.

## A restoration and classification

All 823 source/project files were classified and verified against I0 before staging. Of 83 untracked files, 75 were delivery files: 11 product files, 27 tests, 3 test helpers, 34 documents/metadata. Eight diagnostic/seed scripts were preserved under evidence/excluded-untracked, outside the repository. The 497 ignored historical JSON records were not staged. No database, .env, runtime uploads, dist or dependencies entered the commit.

The A baseline contains exactly 106 changed paths (31 previously modified + 75 newly tracked). Each staging path was explicitly allowlisted; no git add . or add -A. Existing trailing-empty-line warnings in 19 A test/report files were recorded in a-existing-whitespace.log and not fixed. LF/CRLF-only stat differences were refreshed via explicit per-path staging with an assertion that the Git tree did not change.

The merged B patch also has trailing-empty-line warnings in four B-added speech/avatar files. These were retained and recorded in integration-whitespace.log rather than silently formatting the delivery. There are no unresolved conflict markers; whitespace checking is not claimed completely clean.

## Conflict resolution

- ClassroomRecordView.vue: preserve A completed-Run and existing-summary edit eligibility, no-content-on-error rendering, ManagementLayout/BackButton and unsaved-change guard. Combine B timeline categorization/pagination and 403 reporting. Use one saved-form baseline and one set of leave/listener hooks; retain A layout and B new timeline CSS.
- ClassroomScreenView.vue: preserve READY/OPENING/SUMMARY, sessionStorage handoff, run retirement, connection/display generations and stale callback guards. Combine B speech helper, artwork error cleanup and timed dismissal. The success/failure callbacks and timer retain A generation checks. Artwork hydration failure must propagate to A's existing recovery boundary, not silently continue as a healthy classroom.
- ClassroomRecordView.spec.ts: retain A running-classroom no-confirm/no-generation assertions and B timeline categorization/pagination test. No assertion removed or skipped.

## Automatically merged files reviewed

- ThreeAvatarStage.vue: retain A existing avatar selection/rendering and B model/texture/mixer cleanup, hidden-page pause, visibility listener cleanup and safe animation fallback.
- ClassroomMobileRemoteView.vue: retain A existing navigation/classroom controls and B recent-command labels/resource metadata prefetch. Metadata prefetch is not binary-media offline caching or playback ACK.
- LessonClassroomView.vue: retain A presentation/teacher control layout and B exclusive-audio handling, pause/resume buttons and stale audio sequence guards. Existing phase-policy/recovery integration gaps remain I2 items.

No backend file is changed by merging B relative to the A baseline. All 375 restored backend files also matched their I0 raw SHA-256 values at the preservation check. Other A files modified by B remain represented through their common Git history; no final-directory overwrite or whole-file ours/theirs resolution was used.

## Tests actually executed

- Frontend targeted: 12 files / 85 passed, 0 failed, 0 skipped on final run. Includes record, screen lifecycle, avatar lifecycle/three-state/resource-disposal, teacher fullscreen/right column, artwork, question history, mobile, browser speech and voice tests.
- First targeted run: 84 passed / 1 failed. Failure was A's artwork-hydration recovery assertion after B's local catch swallowed the error. The merge hunk was corrected to preserve A's recovery boundary, without changing the test. Original log retained as frontend-target.log; final log is frontend-target-final.log.
- Backend targeted isolated SQLite HTTP E2E: cockpit, screen lifecycle and operation policy; 3 suites / 31 passed, 0 failed, 0 skipped.
- Frontend type-check and non-fixing ESLint passed; production build passed with existing large-chunk warning.
- Backend build/type-check/lint passed; lint reports six existing warnings in prior files.
- Frontend first sandbox build/test attempts failed with child-process spawn EPERM before execution; approved outside-sandbox reruns succeeded. No browser, formal service, formal database, migration or full-suite run was performed.

## Deferred P1 and next batch

No CommandBus recovery, allowedActions or event-origin presentation identity adaptation was implemented. Preserve these known issues for I2: nullable recovery classroomState/refreshRequired handling; player callbacks must carry original command+revision rather than current identity; capability hints not fully consumed; artwork delivery wording is not ACK; local TTS resume phase handling. Mobile clock/TTL and A1/cockpit frontend integration remain separately tracked.

Recommend I2 first address the CommandBus recovery response envelope: keep the immutable first business result separate from current state, consume refreshRequired and fetch a full authoritative projection, then add regression tests for normal and recovered results. Do not alter canonical transaction/receipt contracts.

Original workspace and I0 final integrity verification, classification, commit ids, test logs and final repository status are recorded in the adjacent evidence directory. Integration commit id is recorded there after the merge commit to avoid a self-referential document hash. Nothing is pushed.
