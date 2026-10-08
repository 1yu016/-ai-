import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import {
  ClassroomCommandOperation,
  ClassroomCommandSource,
} from '../classroom-command.types';

export class ExecuteClassroomCommandDto {
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  requestId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  runId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  deviceId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsEnum(ClassroomCommandSource)
  source: ClassroomCommandSource;

  @IsEnum(ClassroomCommandOperation)
  operation: ClassroomCommandOperation;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetDeviceId?: number;

  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  issuedAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(120000)
  ttlMs?: number;
}
