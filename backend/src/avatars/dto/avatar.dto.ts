import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  AvatarActionName,
  AvatarAssetType,
  AvatarCategory,
  AvatarCharacterStatus,
  AvatarModelFormat,
  AvatarVersionStatus,
} from '../avatar.types';

export class CreateAvatarCharacterDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsEnum(AvatarCategory) category: AvatarCategory;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

export class UpdateAvatarCharacterDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsEnum(AvatarCategory) category?: AvatarCategory;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

export class ListAvatarCharacterQueryDto {
  @IsOptional() @IsEnum(AvatarCategory) category?: AvatarCategory;
  @IsOptional() @IsEnum(AvatarCharacterStatus) status?: AvatarCharacterStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class CreateAvatarVersionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._-]+$/)
  engineVersion: string;

  @IsEnum(AvatarModelFormat) modelFormat: AvatarModelFormat;

  @IsOptional() @IsString() @MaxLength(10_000) compatibility?: string;
}

export class UploadAvatarAssetDto {
  @IsEnum(AvatarAssetType) assetType: AvatarAssetType;
  @IsOptional()
  @Transform(({ value }) => (value === 'talk' ? AvatarActionName.Speak : value))
  @IsEnum(AvatarActionName)
  actionName?: AvatarActionName;
  @IsOptional() @IsString() @MaxLength(10_000) metadata?: string;
}

export class ReviewAvatarCharacterDto {
  @IsEnum(AvatarCharacterStatus) status: AvatarCharacterStatus;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

export class DisableAvatarVersionDto {
  @IsEnum(AvatarVersionStatus) status: AvatarVersionStatus;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
