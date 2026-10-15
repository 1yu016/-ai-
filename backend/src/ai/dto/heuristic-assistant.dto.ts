import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export enum HeuristicConversationRole {
  Child = 'child',
  Assistant = 'assistant',
  Teacher = 'teacher',
}

export enum HeuristicSafetyStatus {
  Safe = 'safe',
  Filtered = 'filtered',
  SafetyRedirect = 'safety_redirect',
}

export enum HeuristicFollowUpType {
  Observe = 'observe',
  Compare = 'compare',
  Experiment = 'experiment',
  Operate = 'operate',
  Choice = 'choice',
  Verify = 'verify',
  TeacherHelp = 'teacher_help',
  None = 'none',
}

export enum HeuristicDraftStatus {
  Processing = 'processing',
  Pending = 'pending',
  Edited = 'edited',
  Confirmed = 'confirmed',
  Discarded = 'discarded',
  Aborted = 'aborted',
  Fallback = 'fallback',
}

export enum HeuristicDecisionAction {
  Edit = 'edit',
  Confirm = 'confirm',
  Discard = 'discard',
  Abort = 'abort',
}

export class HeuristicConversationItemDto {
  @IsEnum(HeuristicConversationRole)
  role: HeuristicConversationRole;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  content: string;
}

export class HeuristicAssistantRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomRunId: number;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  childText: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  activityGoal: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  attemptCount: number;

  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => HeuristicConversationItemDto)
  conversationContext: HeuristicConversationItemDto[];

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  requestId: string;
}

export class HeuristicAssistantModelResultDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  responseText: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  hintLevel: number;

  @IsEnum(HeuristicSafetyStatus)
  safetyStatus: HeuristicSafetyStatus;

  @IsEnum(HeuristicFollowUpType)
  followUpType: HeuristicFollowUpType;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  recommendedResourceId: number | null;

  @IsBoolean()
  requiresTeacherConfirmation: boolean;
}

export class HeuristicAssistantDecisionDto {
  @IsEnum(HeuristicDecisionAction)
  action: HeuristicDecisionAction;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  editedResponseText?: string;
}
