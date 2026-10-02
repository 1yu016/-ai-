import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ClassroomCheckpointType } from '../classroom-run.types';
import {
  CancelClassroomAvatarBindingDto,
  SetClassroomAvatarBindingDto,
} from '../../avatars/dto/avatar-config.dto';

export { CancelClassroomAvatarBindingDto, SetClassroomAvatarBindingDto };

export class RequestIdDto {
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  requestId: string;
}

export class StartClassroomRunDto extends RequestIdDto {
  @Type(() => Number) @IsInt() @Min(1) lessonPlanId: number;
  @Type(() => Number) @IsInt() @Min(1) classId: number;
  @Type(() => Number) @IsInt() @Min(1) classroomId: number;
  @Type(() => Number) @IsInt() @Min(1) deviceId: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) avatarVersionId?: number;
}

export class ClassroomRunOperationDto extends RequestIdDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
  @Type(() => Number) @IsInt() @Min(1) deviceId: number;
}

export class ChangeClassroomStepDto extends ClassroomRunOperationDto {
  @Type(() => Number) @IsInt() @Min(0) stepIndex: number;
}

export class ActiveClassroomRunsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) deviceId?: number;
}

export class RestoreClassroomRunQueryDto {
  @Type(() => Number) @IsInt() @Min(1) deviceId: number;
}

export class TakeoverClassroomRunDto extends RequestIdDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
  @Type(() => Number) @IsInt() @Min(1) oldDeviceId: number;
  @Type(() => Number) @IsInt() @Min(1) newDeviceId: number;
  @IsBoolean() teacherConfirmed: boolean;
  @IsString() @MinLength(1) @MaxLength(500) reason: string;
}

export class RecoverClassroomRunDto extends ClassroomRunOperationDto {}

export class ClassroomCheckpointDto extends ClassroomRunOperationDto {
  @IsEnum(ClassroomCheckpointType) checkpointType: ClassroomCheckpointType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) resourceId?: number;
  @IsOptional() @IsObject() attendanceState?: Record<string, unknown>;
  @IsOptional() @IsObject() rollCallState?: Record<string, unknown>;
  @IsOptional() @IsObject() rewardState?: Record<string, unknown>;
  @IsOptional() @IsObject() interactionState?: Record<string, unknown>;
  @IsOptional() @IsObject() playerState?: Record<string, unknown>;
}

/** Stage 7.3：给某幼儿发一朵（或几朵）小红花。 */
export class CreateClassroomRewardDto extends RequestIdDto {
  @Type(() => Number) @IsInt() @Min(1) studentId: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) stars?: number;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
