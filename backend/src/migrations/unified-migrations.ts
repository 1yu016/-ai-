import { LegacyFeatureTables2026110200033 } from './202611020033-LegacyFeatureTables';
import { IntegrationSchemaCompatibility2026110200032 } from './202611020032-IntegrationSchemaCompatibility';
import { AvatarCharacterAssets2026092700008 } from './202609270008-AvatarCharacterAssets';
import { AvatarConfigurationBindings2026092700009 } from './202609270009-AvatarConfigurationBindings';
import { ClassroomCommandBus2026100600014 } from './202610060014-ClassroomCommandBus';
import { ClassroomDirector2026100600018 } from './202610060018-ClassroomDirector';
import { ClassroomDirectorSuggestions2026092700010 } from './202609270010-ClassroomDirectorSuggestions';
import { ClassroomEngagement2026093000014 } from './202609300014-ClassroomEngagement';
import { ClassroomMobileRealtime2026100700023 } from './202610070023-ClassroomMobileRealtime';
import { ClassroomParticipation2026092800013 } from './202609280013-ClassroomParticipation';
import { ClassroomRecords2026100700021 } from './202610070021-ClassroomRecords';
import { ClassroomRunBreakFields2026100200013 } from './202610020013-ClassroomRunBreakFields';
import { ClassroomRunStateMachine2026092700006 } from './202609270006-ClassroomRunStateMachine';
import { ClassroomRunStepSnapshotHints2026100700010 } from './202610070010-ClassroomRunStepSnapshotHints';
import { ClassroomSnapshotRecovery2026092700007 } from './202609270007-ClassroomSnapshotRecovery';
import { ClassroomTicketForeignKeys2026092700003 } from './202609270003-ClassroomTicketForeignKeys';
import { ClassroomBreakMode2026100600017 } from './202610060017-ClassroomBreakMode';
import { ClassroomCommands2026092800012 } from './202609280012-ClassroomCommands';
import { ChildQaAnswerFields2026101200026 } from './202610120026-ChildQaAnswerFields';
import { LessonStepActionColumnName2026101200027 } from './202610120027-LessonStepActionColumnName';
import { ChildQaLessonConfig2026101200028 } from './202610120028-ChildQaLessonConfig';
import { ChildQaCommandTypes2026101200029 } from './202610120029-ChildQaCommandTypes';
import { ChildQaAnswerColumnLengths2026101200030 } from './202610120030-ChildQaAnswerColumnLengths';
import { StudentQuestionIndexes2026101200031 } from './202610120031-StudentQuestionIndexes';
import { FormalAttendanceRollCall2026100600015 } from './202610060015-FormalAttendanceRollCall';
import { HeuristicAssistantDrafts2026092700011 } from './202609270011-HeuristicAssistantDrafts';
import { LessonPreparationStageThree2026092700005 } from './202609270005-LessonPreparationStageThree';
import { RefreshSessionTokenVersion2026092700002 } from './202609270002-RefreshSessionTokenVersion';
import { ResourceLibraryStageTwo2026092700004 } from './202609270004-ResourceLibraryStageTwo';
import { ResourceUploadSessionMetadata2026101100025 } from './202610110025-ResourceUploadSessionMetadata';
import { RewardGrowthHonor2026100600016 } from './202610060016-RewardGrowthHonor';
import { StageOnePlatformFoundation2026092700001 } from './202609270001-StageOnePlatformFoundation';
import { StudentArtworkRecords2026100700022 } from './202610070022-StudentArtworkRecords';
import { StudentQuestionMap2026100600020 } from './202610060020-StudentQuestionMap';
import { StudentRewardRecord2026100200011 } from './202610020011-StudentRewardRecord';
import { StudentRewardRecordIndexes2026100200012 } from './202610020012-StudentRewardRecordIndexes';
import { TeacherCommandSynonym2026100600019 } from './202610060019-TeacherCommandSynonym';
import { DeviceSession2026100900024 } from './202610090024-DeviceSession';

/** One source of truth for startup and the explicit migration command. */
export const UNIFIED_MIGRATIONS = [
  StageOnePlatformFoundation2026092700001,
  RefreshSessionTokenVersion2026092700002,
  ClassroomTicketForeignKeys2026092700003,
  ResourceLibraryStageTwo2026092700004,
  LessonPreparationStageThree2026092700005,
  ClassroomRunStateMachine2026092700006,
  ClassroomSnapshotRecovery2026092700007,
  AvatarCharacterAssets2026092700008,
  AvatarConfigurationBindings2026092700009,
  ClassroomRunStepSnapshotHints2026100700010,
  StudentRewardRecord2026100200011,
  StudentRewardRecordIndexes2026100200012,
  ClassroomRunBreakFields2026100200013,
  ClassroomDirectorSuggestions2026092700010,
  HeuristicAssistantDrafts2026092700011,
  ClassroomCommands2026092800012,
  ClassroomParticipation2026092800013,
  ClassroomEngagement2026093000014,
  ClassroomCommandBus2026100600014,
  FormalAttendanceRollCall2026100600015,
  RewardGrowthHonor2026100600016,
  ClassroomBreakMode2026100600017,
  ClassroomDirector2026100600018,
  TeacherCommandSynonym2026100600019,
  StudentQuestionMap2026100600020,
  ClassroomRecords2026100700021,
  StudentArtworkRecords2026100700022,
  ClassroomMobileRealtime2026100700023,
  DeviceSession2026100900024,
  ResourceUploadSessionMetadata2026101100025,
  ChildQaAnswerFields2026101200026,
  LessonStepActionColumnName2026101200027,
  ChildQaLessonConfig2026101200028,
  ChildQaCommandTypes2026101200029,
  ChildQaAnswerColumnLengths2026101200030,
  StudentQuestionIndexes2026101200031,
  IntegrationSchemaCompatibility2026110200032,
  LegacyFeatureTables2026110200033,
];
