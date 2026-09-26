import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
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
import { ClassroomCommandIntent } from './command.dto';

export enum ClassroomSpeaker {
  Child = 'child',
  Teacher = 'teacher',
  Assistant = 'assistant',
}

export enum AssistantCapability {
  GuidedQuestion = 'guided_question',
  GiveHint = 'give_hint',
  FollowUp = 'follow_up',
  Encourage = 'encourage',
  Summarize = 'summarize',
  RecommendResource = 'recommend_resource',
  ClassroomCommand = 'classroom_command',
  SafetyRedirect = 'safety_redirect',
  Unknown = 'unknown',
}

export enum AssistantResponseLength {
  Short = 'short',
  Medium = 'medium',
  Long = 'long',
}

export enum AssistantSuggestedActionType {
  RecommendResource = 'recommend_resource',
  ClassroomCommand = 'classroom_command',
}

export class AssistantAvailableResourceDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id: number;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsEnum(ResourceType)
  type: ResourceType;
}

export class AssistantActivityContextDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  theme: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  objective: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  currentStep: string;

  @IsOptional()
  @IsEnum(AssistantResponseLength)
  responseLength: AssistantResponseLength = AssistantResponseLength.Short;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  askedQuestions: string[] = [];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3)
  attemptCount = 0;

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AssistantAvailableResourceDto)
  availableResources: AssistantAvailableResourceDto[];
}

export class AssistantHistoryItemDto {
  @IsEnum(ClassroomSpeaker)
  role: ClassroomSpeaker;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  content: string;
}

export class ClassroomAssistantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text: string;

  @IsIn([ClassroomSpeaker.Child, ClassroomSpeaker.Teacher])
  speaker: ClassroomSpeaker;

  @IsEnum(ResourceAgeGroup)
  ageGroup: ResourceAgeGroup;

  @ValidateNested()
  @Type(() => AssistantActivityContextDto)
  activityContext: AssistantActivityContextDto;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AssistantHistoryItemDto)
  history: AssistantHistoryItemDto[];

  @IsOptional()
  @IsEnum(AssistantCapability)
  tool?: AssistantCapability;
}

export class AssistantSuggestedActionDto {
  @IsEnum(AssistantSuggestedActionType)
  type: AssistantSuggestedActionType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  resourceId?: number;

  @IsOptional()
  @IsEnum(ClassroomCommandIntent)
  commandIntent?: ClassroomCommandIntent;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description: string;
}

export class ClassroomAssistantModelResultDto {
  @IsIn(['guided_dialogue'])
  mode: 'guided_dialogue';

  @IsOptional()
  @IsEnum(AssistantCapability)
  ability?: AssistantCapability;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reply: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  teacherTip: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AssistantSuggestedActionDto)
  suggestedAction?: AssistantSuggestedActionDto | null;

  @IsBoolean()
  requiresTeacherConfirmation: boolean;
}
