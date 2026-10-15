import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AvatarActionName, AvatarVoiceStatus } from '../avatar.types';

export class ConfigurationReasonDto {
  @IsString() @MinLength(1) @MaxLength(500) reason: string;
}

export class UpsertAvatarVoiceProfileDto extends ConfigurationReasonDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9._-]+$/)
  provider: string;
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  voiceId: string;
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  @Matches(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/)
  language: string;
  @Type(() => Number) @IsNumber() @Min(0.5) @Max(2) speed: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(1) volume: number;
  @Type(() => Number) @IsNumber() @Min(-12) @Max(12) pitch: number;
  @IsEnum(AvatarVoiceStatus) status: AvatarVoiceStatus;
}

export class UpsertAvatarPersonalityDto extends ConfigurationReasonDto {
  @IsString() @MinLength(1) @MaxLength(80) style: string;
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  catchphrases: string[];
  @IsString() @MinLength(1) @MaxLength(500) greeting: string;
  @IsString() @MinLength(1) @MaxLength(500) encouragementStyle: string;
  @IsString() @MinLength(1) @MaxLength(500) goodbyeText: string;
}

export class SetAvatarBindingDto extends ConfigurationReasonDto {
  @Type(() => Number) @IsInt() @Min(1) characterId: number;
  @Type(() => Number) @IsInt() @Min(1) versionId: number;
}

export class SetClassroomAvatarBindingDto extends SetAvatarBindingDto {
  @Type(() => Number) @IsInt() @Min(1) deviceId: number;
  @Type(() => Number) @IsInt() @Min(1) version: number;
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  requestId: string;
}

export class CancelClassroomAvatarBindingDto extends ConfigurationReasonDto {
  @Type(() => Number) @IsInt() @Min(1) deviceId: number;
  @Type(() => Number) @IsInt() @Min(1) version: number;
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  requestId: string;
}

export class ResolveAvatarQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) classId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) lessonPlanId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) classroomRunId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) deviceId?: number;
  @IsOptional()
  @Transform(({ value }) => (value === 'talk' ? AvatarActionName.Speak : value))
  @IsEnum(AvatarActionName)
  actionName?: AvatarActionName;
}
