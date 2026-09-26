import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { LessonAgeGroup, LessonPlanStatus, LessonStepType } from '../lesson-plan.types';

export class CreateLessonPlanDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsString() @MinLength(1) @MaxLength(200) theme: string;
  @IsEnum(LessonAgeGroup) ageGroup: LessonAgeGroup;
  @IsString() @MinLength(1) @MaxLength(3000) objectives: string;
  @Type(() => Number) @IsInt() @Min(5) @Max(120) estimatedMinutes: number;
  @IsOptional() @IsEnum(LessonPlanStatus) status?: LessonPlanStatus;
}

export class UpdateLessonPlanDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) theme?: string;
  @IsOptional() @IsEnum(LessonAgeGroup) ageGroup?: LessonAgeGroup;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(3000) objectives?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(120) estimatedMinutes?: number;
  @IsOptional() @IsEnum(LessonPlanStatus) status?: LessonPlanStatus;
}

export class LessonStepDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) sortOrder?: number;
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsEnum(LessonStepType) stepType: LessonStepType;
  @IsString() @MinLength(1) @MaxLength(3000) instruction: string;
  @IsOptional() @IsString() @MaxLength(1000) expectedResponse?: string;
  @IsOptional() @IsString() @MaxLength(1000) teacherTip?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) resourceId?: number;
  @Type(() => Number) @IsInt() @Min(10) @Max(7200) durationSeconds: number;
}

export class SaveLessonStepsDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => LessonStepDto) steps: LessonStepDto[];
}

export class ListLessonPlansQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsString() @MaxLength(200) keyword?: string;
  @IsOptional() @IsEnum(LessonAgeGroup) ageGroup?: LessonAgeGroup;
  @IsOptional() @IsEnum(LessonPlanStatus) status?: LessonPlanStatus;
}

export class UpdateLessonRunProgressDto {
  @Type(() => Number) @IsInt() @Min(1) currentStepOrder: number;
}
