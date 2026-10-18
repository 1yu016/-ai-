/** Frozen minimal provenance contract for a future authoring integration.
 * Server-derived only. This batch does not change the authoring save path.
 * Never embed the complete evidence pack in a formal version.
 */
export interface ExperienceProvenanceV1 {
  contractVersion: 1;
  draftId: number;
  candidateId: string;
  evidenceDigest: string;
  referenceRunIds: number[];
  sourceLessonVersions: Array<{
    runId: number;
    lessonPlanId: number;
    versionNo: number;
    versionId: number | null;
    snapshotDigest: string | null;
  }>;
}
