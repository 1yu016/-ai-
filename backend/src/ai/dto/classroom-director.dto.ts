import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsDefined,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';

export enum ClassroomDirectorSuggestionType {
  AskQuestion = 'ask_question',
  GroupActivity = 'group_activity',
  Summarize = 'summarize',
  Transition = 'transition',
  RecommendResource = 'recommend_resource',
  SwitchStep = 'switch_step',
  RewardSuggestion = 'reward_suggestion',
  TimeAdjustment = 'time_adjustment',
}

export enum ClassroomDirectorDecision {
  Accepted = 'accepted',
  Edited = 'edited',
  Rejected = 'rejected',
  Ignored = 'ignored',
}

export enum ClassroomDirectorSuggestionStatus {
  Processing = 'processing',
  Generated = 'generated',
  Fallback = 'fallback',
}

export class ClassroomDirectorRequestDto {
  @Type(() => Number) @IsInt() @Min(1) classroomRunId: number;
  @Type(() => Number) @IsInt() @Min(0) currentStepIndex: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(600) remainingMinutes: number;
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  recentEvents: string[];
  @IsString() @MinLength(1) @MaxLength(500) teacherRequest: string;
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  requestId: string;
}

export class ClassroomDirectorResourceCandidateDto {
  @Type(() => Number) @IsInt() @Min(1) resourceId: number;
  @IsString() @MinLength(1) @MaxLength(300) reason: string;
}

export class ClassroomDirectorSuggestedActionDto {
  @IsEnum(ClassroomDirectorSuggestionType)
  type: ClassroomDirectorSuggestionType;
  @IsString() @MinLength(1) @MaxLength(500) description: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) resourceId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) stepIndex?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-30)
  @Max(30)
  minuteDelta?: number;
}

export class ClassroomDirectorModelResultDto {
  @IsEnum(ClassroomDirectorSuggestionType)
  suggestionType: ClassroomDirectorSuggestionType;
  @IsString() @MinLength(1) @MaxLength(800) teacherMessage: string;
  @IsString() @MinLength(1) @MaxLength(800) reason: string;
  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @ValidateNested()
  @Type(() => ClassroomDirectorSuggestedActionDto)
  suggestedAction: ClassroomDirectorSuggestedActionDto | null;
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => ClassroomDirectorResourceCandidateDto)
  resourceCandidates: ClassroomDirectorResourceCandidateDto[];
  @Type(() => Number) @IsNumber() @Min(0) @Max(1) confidence: number;
  @IsBoolean() requiresConfirmation: boolean;
}

export class ClassroomDirectorDecisionDto {
  @IsEnum(ClassroomDirectorDecision) decision: ClassroomDirectorDecision;
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(800)
  editedTeacherMessage?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => ClassroomDirectorSuggestedActionDto)
  editedSuggestedAction?: ClassroomDirectorSuggestedActionDto;
  @IsBoolean() executed: boolean;
  @IsOptional() @IsString() @MaxLength(500) executionResult?: string;
}
