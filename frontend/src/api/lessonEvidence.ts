import { http } from './http'

export type ReferenceRun = { runId:number; title:string; lessonPlanVersion:number; startedAt:string|null;
  endedAt:string; hasFormalSummary:boolean }
export type EvidencePack = {
  schemaVersion:number; ruleVersion:string; targetLessonPlanId:number; baseVersion:number; digest:string; generatedAt:string;
  warnings:string[]; usageNotice:string;
  sourceManifest:Array<{runId:number;historicalVersionId:number|null;historicalVersionDigest:string|null;
    summary:{id:number;updatedAt:string;digest:string}|null}>;
  safeFacts:{runs:Array<{runId:number;lessonPlanVersion:number;recordedElapsedSeconds:number;
    facts:Array<{evidenceId:string;type:string;occurredAt:string}>;limitations:string[]}>};
  teacherReview:Array<{runId:number;title:string;steps:Array<{historicalStepId:number;title:string;plannedDurationSeconds:number;historyMatched:boolean}>;
    formalSummary:{classroomSummary:string;participation:string;interestPoints:string;commonQuestions:string;teachingStrategies:string;label:string}|null}>;
}
export const lessonEvidenceApi = {
  list: (id:number,params:{page:number;pageSize:number;lessonPlanVersion?:number;from?:string;to?:string}) =>
    http.get<{items:ReferenceRun[];total:number;page:number;pageSize:number}>(`/lesson-plans/${id}/reference-runs`,{params}),
  build: (id:number,input:{baseVersion:number;runIds:number[]}) => http.post<EvidencePack>(`/lesson-plans/${id}/evidence-pack`,input),
}
