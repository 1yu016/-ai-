import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { LessonAgeGroup, LessonStepType } from '../../lesson-plans/lesson-plan.types';

export class LessonPlanDraftRequestDto {
  @IsString() @MinLength(1) @MaxLength(200) theme: string;
  @IsEnum(LessonAgeGroup) ageGroup: LessonAgeGroup;
  @Type(() => Number) @IsInt() @Min(5) @Max(120) durationMinutes: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(3000) objectives?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @Type(() => Number) @IsInt({ each: true }) @Min(1, { each: true }) resourceIds: number[] = [];
}

export class LessonPlanDraftStepDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsEnum(LessonStepType) stepType: LessonStepType;
  @IsString() @MinLength(1) @MaxLength(1000) instruction: string;
  @IsOptional() @IsString() @MaxLength(500) expectedResponse?: string;
  @IsOptional() @IsString() @MaxLength(500) teacherTip?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) resourceId?: number;
  @Type(() => Number) @IsInt() @Min(10) @Max(7200) durationSeconds: number;
}

export class LessonPlanDraftResultDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsString() @MinLength(1) @MaxLength(200) theme: string;
  @IsEnum(LessonAgeGroup) ageGroup: LessonAgeGroup;
  @Type(() => Number) @IsInt() @Min(5) @Max(120) estimatedMinutes: number;
  @IsString() @MinLength(1) @MaxLength(3000) objectives: string;
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => LessonPlanDraftStepDto) steps: LessonPlanDraftStepDto[];
}
