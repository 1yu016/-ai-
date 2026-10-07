import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ClassroomCommandOperation } from '../../classroom-runs/classroom-command.types';
export enum ClassroomDirectorSuggestionType {
  Question = 'question',
  Grouping = 'grouping',
  Summary = 'summary',
  Transition = 'transition',
  Resource = 'resource',
  Reward = 'reward',
  Pacing = 'pacing',
}

export enum ClassroomDirectorResultStatus {
  Ready = 'ready',
  SafetyRedirect = 'safety_redirect',
  Degraded = 'degraded',
}

export const DIRECTOR_COMMAND_OPERATIONS = [
  ClassroomCommandOperation.PreviousStep,
  ClassroomCommandOperation.NextStep,
  ClassroomCommandOperation.SwitchStep,
  ClassroomCommandOperation.OpenResource,
  ClassroomCommandOperation.PlayResource,
  ClassroomCommandOperation.PauseMedia,
  ClassroomCommandOperation.ResumeMedia,
  ClassroomCommandOperation.StopMedia,
  ClassroomCommandOperation.SetVolume,
  ClassroomCommandOperation.Mute,
  ClassroomCommandOperation.Unmute,
  ClassroomCommandOperation.GroupRollCall,
  ClassroomCommandOperation.RewardStudent,
] as const;

export class DirectorTimelineItemDto {
  @Type(() => Number) @IsInt() @Min(0) stepIndex: number;
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(7200) durationSeconds: number;
}

export class DirectorCurrentResourceDto {
  @Type(() => Number) @IsInt() @Min(1) id: number;
  @IsString() @MinLength(1) @MaxLength(200) title: string;
}

export class ClassroomDirectorRequestDto {
  @Type(() => Number) @IsInt() @Min(1) classroomRunId: number;
  @IsString() @MinLength(1) @MaxLength(500) currentStep: string;

  @IsArray() @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => DirectorTimelineItemDto)
  timeline: DirectorTimelineItemDto[];

  @Type(() => Number) @IsInt() @Min(0) @Max(86400) elapsedSeconds: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(86400) remainingSeconds: number;

  @IsArray() @ArrayMaxSize(100) @IsInt({ each: true }) completedStepIndexes: number[];

  @IsOptional() @ValidateNested() @Type(() => DirectorCurrentResourceDto)
  currentResource?: DirectorCurrentResourceDto | null;

  @IsString() @MaxLength(1000) attendanceSummary: string;
  @IsString() @MaxLength(1500) interactionSummary: string;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(300, { each: true })
  recentQuestions: string[];
  @IsString() @MinLength(1) @MaxLength(500) teacherGoal: string;
}

export class ClassroomDirectorSuggestionDto {
  @IsEnum(ClassroomDirectorSuggestionType) type: ClassroomDirectorSuggestionType;
  @IsString() @MinLength(1) @MaxLength(100) title: string;
  @IsString() @MinLength(1) @MaxLength(500) content: string;
  @IsString() @MinLength(1) @MaxLength(300) rationale: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) resourceId?: number;
  @IsOptional() @IsIn(DIRECTOR_COMMAND_OPERATIONS) commandOperation?: ClassroomCommandOperation;
  @IsOptional() @IsObject() commandParameters?: Record<string, unknown>;
}

export class ClassroomDirectorModelResultDto {
  @IsIn(['classroom_director']) mode: 'classroom_director';
  @IsEnum(ClassroomDirectorResultStatus) status: ClassroomDirectorResultStatus;
  @IsString() @MaxLength(300) message: string;
  @IsArray() @ArrayMaxSize(7)
  @ValidateNested({ each: true }) @Type(() => ClassroomDirectorSuggestionDto)
  suggestions: ClassroomDirectorSuggestionDto[];
}

export class DirectorSuggestionEditDto {
  @IsString() @MinLength(1) @MaxLength(500) content: string;
}

export class DirectorSuggestionDecisionDto {
  @IsString() @MinLength(8) @MaxLength(100) requestId: string;
  @Type(() => Number) @IsInt() @Min(1) deviceId: number;
  @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) targetDeviceId?: number;
  @IsOptional() @IsObject() commandParameters?: Record<string, unknown>;
}
