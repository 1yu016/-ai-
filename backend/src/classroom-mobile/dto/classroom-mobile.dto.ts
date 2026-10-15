import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ClassroomCommandOperation } from '../../classroom-runs/classroom-command.types';

export class JoinClassroomMobileDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  ticket: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  deviceCode: string;
}

export class ExecuteMobileClassroomCommandDto {
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  requestId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsEnum(ClassroomCommandOperation)
  operation: ClassroomCommandOperation;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetDeviceId: number;

  @IsISO8601()
  issuedAt: string;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(120000)
  ttlMs: number;

  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}

export class MobileDiscoveryParamDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  deviceCode: string;
}
