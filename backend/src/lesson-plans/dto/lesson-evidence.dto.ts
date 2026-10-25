import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ReferenceRunsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) lessonPlanVersion?: number;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class BuildEvidencePackDto {
  @IsInt() @Min(1) baseVersion: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @IsInt({ each: true }) @Min(1, { each: true })
  runIds: number[];
}
