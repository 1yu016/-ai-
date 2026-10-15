import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsIn,
  IsNumber,
  IsObject,
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
import { ResourceType } from '../../data/entities/teaching-resource.entity';

const CLASSROOM_COMMAND_LOCALE = /^(?:zh(?:-CN)?|en(?:-US)?)$/i;

export enum ClassroomCommandV2Intent {
  NextPage = 'next_page',
  PreviousPage = 'previous_page',
  Play = 'play',
  Pause = 'pause',
  Resume = 'resume',
  Stop = 'stop',
  ZoomIn = 'zoom_in',
  ZoomOut = 'zoom_out',
  CallStudent = 'call_student',
  Reward = 'reward',
  Mute = 'mute',
  Unmute = 'unmute',
  BreakMode = 'break_mode',
  ReturnToClass = 'return_to_class',
  NextStep = 'next_step',
  PreviousStep = 'previous_step',
  Unknown = 'unknown',
}

export enum ClassroomCommandRecognitionSource {
  Local = 'local',
  Custom = 'custom',
  Ai = 'ai',
  Offline = 'offline',
}

export enum ClassroomCommandRecordStatus {
  Processing = 'processing',
  Recognized = 'recognized',
  Unknown = 'unknown',
  AwaitingSelection = 'awaiting_selection',
  Executing = 'executing',
  Executed = 'executed',
  Rejected = 'rejected',
  Error = 'error',
}

export enum OfflineCommandResult {
  Executed = 'executed',
  Rejected = 'rejected',
  Error = 'error',
}

export class ClassroomCommandV2ContextDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  currentResourceId?: number;

  @IsOptional()
  @IsString()
  @IsIn([
    'classroom',
    'lesson',
    'resource',
    'picture_book',
    'ppt',
    'video',
    'chat',
  ])
  @MaxLength(50)
  currentPage?: string;

  @IsOptional()
  @IsString()
  @IsIn(['idle', 'loading', 'playing', 'paused', 'ended', 'error'])
  @MaxLength(30)
  playerStatus?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  selectedStudentId?: number;

  @IsOptional()
  @IsEnum(ResourceType)
  resourceType?: ResourceType;
}

export class ClassroomCommandV2RequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomRunId: number;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text: string;

  @IsString()
  @Matches(CLASSROOM_COMMAND_LOCALE)
  @MaxLength(10)
  locale: string;

  @ValidateNested()
  @Type(() => ClassroomCommandV2ContextDto)
  context: ClassroomCommandV2ContextDto;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  requestId: string;
}

export class ClassroomCommandParametersDto {
  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  resourceId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  resourceKeyword?: string;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  studentId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  studentName?: string;
}

export class ClassroomCommandModelResultDto {
  @IsEnum(ClassroomCommandV2Intent)
  intent: ClassroomCommandV2Intent;

  @ValidateNested()
  @Type(() => ClassroomCommandParametersDto)
  parameters: ClassroomCommandParametersDto;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(1)
  confidence: number;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  message: string;
}

export class ExecuteClassroomCommandDto {
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  @Matches(/^[A-Za-z0-9_-]+$/)
  executionToken: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  requestId: string;
}

export class SaveClassroomCommandRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  phrase: string;

  @IsString()
  @Matches(CLASSROOM_COMMAND_LOCALE)
  @MaxLength(10)
  locale: string;

  @IsEnum(ClassroomCommandV2Intent)
  intent: ClassroomCommandV2Intent;

  @IsOptional()
  @IsObject()
  parameterTemplate?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsDateString()
  validUntil?: string;
}

export class DownloadClassroomRulesQueryDto {
  @IsString()
  @Matches(CLASSROOM_COMMAND_LOCALE)
  @MaxLength(10)
  locale: string;
}

export class OfflineCommandLogItemDto {
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  localEventId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  classroomRunId: number;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text: string;

  @IsEnum(ClassroomCommandV2Intent)
  intent: ClassroomCommandV2Intent;

  @IsObject()
  parameters: Record<string, unknown>;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  ruleVersion: number;

  @IsEnum(OfflineCommandResult)
  result: OfflineCommandResult;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  errorCode?: string;

  @IsDateString()
  executedAt: string;
}

export class UploadOfflineCommandLogsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OfflineCommandLogItemDto)
  logs: OfflineCommandLogItemDto[];
}
