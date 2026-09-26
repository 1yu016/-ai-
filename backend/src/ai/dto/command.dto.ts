import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ResourceAgeGroup,
  ResourceType,
} from '../../data/entities/teaching-resource.entity';

export enum ClassroomCommandIntent {
  SearchResource = 'search_resource',
  OpenResource = 'open_resource',
  PlayResource = 'play_resource',
  PauseMedia = 'pause_media',
  ResumeMedia = 'resume_media',
  StopMedia = 'stop_media',
  CloseResource = 'close_resource',
  VolumeUp = 'volume_up',
  VolumeDown = 'volume_down',
  OpenChat = 'open_chat',
  OpenResources = 'open_resources',
  StartActivity = 'start_activity',
  NextStep = 'next_step',
  PreviousStep = 'previous_step',
  Unknown = 'unknown',
}

export enum ClassroomPage {
  Chat = 'chat',
  Resources = 'resources',
  Favorites = 'favorites',
}

export enum CommandPlayerStatus {
  Idle = 'idle',
  Loading = 'loading',
  Playing = 'playing',
  Paused = 'paused',
  Ended = 'ended',
  Error = 'error',
}

export class ClassroomCommandContextDto {
  @IsEnum(ClassroomPage)
  currentPage: ClassroomPage;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  currentResourceId?: number;

  @IsEnum(CommandPlayerStatus)
  playerStatus: CommandPlayerStatus;

  @IsOptional()
  @IsEnum(ResourceAgeGroup)
  ageGroup?: ResourceAgeGroup;
}

export class ClassroomCommandDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text: string;

  @ValidateNested()
  @Type(() => ClassroomCommandContextDto)
  context: ClassroomCommandContextDto;
}

export class CommandModelResultDto {
  @IsIn(['command'])
  mode: 'command';

  @IsEnum(ClassroomCommandIntent)
  intent: ClassroomCommandIntent;

  @IsOptional()
  @IsEnum(ResourceType)
  resourceType?: ResourceType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(1)
  confidence: number;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reply: string;

  @IsBoolean()
  requiresConfirmation: boolean;
}
