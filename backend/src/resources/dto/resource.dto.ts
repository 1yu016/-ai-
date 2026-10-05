import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsHash,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ResourceAgeGroup,
  ResourceReviewStatus,
  ResourceType,
} from '../../data/entities/teaching-resource.entity';

function parseStringArray(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

export class UploadResourceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsEnum(ResourceType)
  resourceType?: ResourceType;

  @IsOptional()
  @Transform(({ value }) => parseStringArray(value))
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  aliases?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @IsEnum(ResourceAgeGroup)
  ageGroup: ResourceAgeGroup;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  domain?: string;

  @IsOptional()
  @Transform(({ value }) => parseStringArray(value))
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  tags?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  duration?: number;
}

export class UpdateResourceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Transform(({ value }) => parseStringArray(value))
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  aliases?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsEnum(ResourceAgeGroup)
  ageGroup?: ResourceAgeGroup;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  domain?: string;

  @IsOptional()
  @Transform(({ value }) => parseStringArray(value))
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  tags?: string[];
}

export class ListResourceQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsEnum(ResourceType)
  resourceType?: ResourceType;

  @IsOptional()
  @IsEnum(ResourceReviewStatus)
  reviewStatus?: ResourceReviewStatus;

  @IsOptional()
  @IsEnum(ResourceAgeGroup)
  ageGroup?: ResourceAgeGroup;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  domain?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tag?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class SearchResourceQueryDto {
  @IsString()
  @MaxLength(200)
  keyword: string;

  @IsOptional()
  @IsEnum(ResourceType)
  resourceType?: ResourceType;
}

export class ResourceReferenceDto {
  @IsString() @MinLength(1) @MaxLength(50) referenceType: string;
  @IsString() @MinLength(1) @MaxLength(100) referenceId: string;
}

export class ResourceReviewDto {
  @IsEnum(ResourceReviewStatus) status: ResourceReviewStatus;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

export class CreateCategoryDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) parentId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sort?: number;
}

export class CreateUploadSessionDto extends UploadResourceDto {
  @IsEnum(ResourceType)
  declare resourceType: ResourceType;

  @IsString() @MinLength(1) @MaxLength(255) originalName: string;
  @IsString() @MinLength(1) @MaxLength(150) declaredMime: string;
  @Type(() => Number) @IsInt() @Min(1) totalSize: number;
  @Type(() => Number)
  @IsInt()
  @Min(64 * 1024)
  @Max(20 * 1024 * 1024)
  chunkSize: number;
  @IsOptional() @IsHash('sha256') expectedSha256?: string;
}

export class ChunkHashDto {
  @IsHash('sha256') sha256: string;
}

export class ConfirmAiSuggestionDto {
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  tags: string[];
  @IsEnum(ResourceAgeGroup) ageGroup: ResourceAgeGroup;
  @IsString() @MaxLength(3000) teachingGoals: string;
  @IsString() @MaxLength(3000) activitySuggestions: string;
}
