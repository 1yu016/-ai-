import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
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

  @IsEnum(ResourceAgeGroup)
  ageGroup: ResourceAgeGroup;

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
  @IsEnum(ResourceAgeGroup)
  ageGroup?: ResourceAgeGroup;

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
