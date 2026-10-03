import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  LessonAgeGroup,
  LessonPlanStatus,
  LessonPlanType,
  LessonRecoveryTrigger,
  LessonStepActionType,
  LessonStepType,
} from '../lesson-plan.types';

export class CreateLessonPlanDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsString() @MinLength(1) @MaxLength(200) theme: string;
  @IsOptional() @IsEnum(LessonPlanType) lessonType?: LessonPlanType;
  @IsEnum(LessonAgeGroup) ageGroup: LessonAgeGroup;
  @IsOptional() @IsString() @MaxLength(100) domain?: string;
  @IsString() @MinLength(1) @MaxLength(3000) objectives: string;
  @Type(() => Number) @IsInt() @Min(5) @Max(120) estimatedMinutes: number;
  @IsOptional() @IsEnum(LessonPlanStatus) status?: LessonPlanStatus;
}

export class UpdateLessonPlanDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) theme?: string;
  @IsOptional() @IsEnum(LessonPlanType) lessonType?: LessonPlanType;
  @IsOptional() @IsEnum(LessonAgeGroup) ageGroup?: LessonAgeGroup;
  @IsOptional() @IsString() @MaxLength(100) domain?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(3000) objectives?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(120)
  estimatedMinutes?: number;
  @IsOptional() @IsEnum(LessonPlanStatus) status?: LessonPlanStatus;
  @IsOptional() @IsString() @MaxLength(500) changeSummary?: string;
}

export class LessonStepActionDto {
  @IsEnum(LessonStepActionType) actionType: LessonStepActionType;
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[a-z][a-z0-9_]*$/)
  actionName: string;
  @IsOptional() @IsString() @MaxLength(500) content?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetStudentId?: number;
}

export class LessonRecoveryPointDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsEnum(LessonRecoveryTrigger) trigger: LessonRecoveryTrigger;
  @Type(() => Number) @IsInt() @Min(1) recoveryStepOrder: number;
  @IsOptional() @IsString() @MaxLength(500) prompt?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class LessonStepDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) sortOrder?: number;
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsEnum(LessonStepType) stepType: LessonStepType;
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(3000)
  content?: string;
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(3000)
  instruction?: string;
  @IsOptional() @IsString() @MaxLength(1000) expectedResponse?: string;
  @IsOptional() @IsString() @MaxLength(1000) teacherTip?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) resourceId?: number;
  @Type(() => Number) @IsInt() @Min(10) @Max(7200) durationSeconds: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => LessonStepActionDto)
  actions?: LessonStepActionDto[];
  @IsOptional()
  @ValidateNested()
  @Type(() => LessonRecoveryPointDto)
  recoveryPoint?: LessonRecoveryPointDto;
}

export class SaveLessonStepsDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LessonStepDto)
  steps: LessonStepDto[];
  @IsOptional() @IsString() @MaxLength(500) changeSummary?: string;
}

export class AddLessonStepDto extends LessonStepDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}

export class UpdateLessonStepDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsEnum(LessonStepType) stepType?: LessonStepType;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(3000) content?: string;
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(3000)
  instruction?: string;
  @IsOptional() @IsString() @MaxLength(1000) expectedResponse?: string;
  @IsOptional() @IsString() @MaxLength(1000) teacherTip?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) resourceId?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(7200)
  durationSeconds?: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => LessonStepActionDto)
  actions?: LessonStepActionDto[];
  @IsOptional()
  @ValidateNested()
  @Type(() => LessonRecoveryPointDto)
  recoveryPoint?: LessonRecoveryPointDto;
}

export class DeleteLessonStepDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}

export class ReorderLessonStepsDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
  @IsArray()
  @ArrayMaxSize(100)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  stepIds: number[];
}

export class ListLessonPlansQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsString() @MaxLength(200) keyword?: string;
  @IsOptional() @IsEnum(LessonAgeGroup) ageGroup?: LessonAgeGroup;
  @IsOptional() @IsEnum(LessonPlanStatus) status?: LessonPlanStatus;
  @IsOptional() @IsEnum(LessonPlanType) lessonType?: LessonPlanType;
  @IsOptional() @IsString() @MaxLength(100) domain?: string;
}

export class UpdateLessonRunProgressDto {
  @Type(() => Number) @IsInt() @Min(1) currentStepOrder: number;
}

export class AiLessonPlanDraftRequestDto {
  @IsString() @MinLength(1) @MaxLength(200) theme: string;
  @IsEnum(LessonAgeGroup) ageGroup: LessonAgeGroup;
  @IsString() @MinLength(1) @MaxLength(100) domain: string;
  @Type(() => Number) @IsInt() @Min(5) @Max(120) durationMinutes: number;
  @IsString() @MinLength(1) @MaxLength(3000) teachingObjectives: string;
  @IsOptional() @IsString() @MaxLength(3000) teacherRequirements?: string;
  @IsOptional() @IsString() @MaxLength(3000) asrText?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  resourceIds: number[] = [];
}

export class AiLessonProcessStepDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsEnum(LessonStepType) stepType: LessonStepType;
  @IsString() @MinLength(1) @MaxLength(1500) content: string;
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(7200)
  durationSeconds: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) resourceId?: number;
}

export class AiResourceRecommendationDto {
  @Type(() => Number) @IsInt() @Min(1) resourceId: number;
  @IsString() @MinLength(1) @MaxLength(500) reason: string;
}

export class AiLessonPlanDraftOutputDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsString() @MinLength(1) @MaxLength(200) theme: string;
  @IsEnum(LessonAgeGroup) ageGroup: LessonAgeGroup;
  @IsString() @MinLength(1) @MaxLength(100) domain: string;
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(120)
  estimatedMinutes: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  teachingObjectives: string[];
  @IsString() @MinLength(1) @MaxLength(1500) introduction: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AiLessonProcessStepDto)
  teachingProcess: AiLessonProcessStepDto[];
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  interactiveQuestions: string[];
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  extensionActivities: string[];
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  assessmentSuggestions: string[];
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AiResourceRecommendationDto)
  resourceRecommendations: AiResourceRecommendationDto[];
}

export class ConfirmAiLessonDraftDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsEnum(LessonPlanType) lessonType?: LessonPlanType;
  @IsOptional() @IsString() @MaxLength(500) changeSummary?: string;
}
