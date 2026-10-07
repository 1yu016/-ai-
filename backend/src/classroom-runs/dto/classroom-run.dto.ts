import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ClassroomBreakContentType,
  ClassroomCheckpointType,
} from '../classroom-run.types';
import {
  CancelClassroomAvatarBindingDto,
  SetClassroomAvatarBindingDto,
} from '../../avatars/dto/avatar-config.dto';
import { RewardCategory, RewardForm } from '../reward-system.types';

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

export class ClassroomScreenStateQueryDto {
  @Type(() => Number) @IsInt() @Min(1) deviceId: number;
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

/** Stage 7.4：开始课间。durationSeconds 限制在 1..1800（前端提供 180/300/600）。 */
export class StartClassroomBreakDto extends ClassroomRunOperationDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1800) durationSeconds: number;
  @IsOptional() @IsEnum(ClassroomBreakContentType)
  contentType?: ClassroomBreakContentType;
  /** 进入课间后无操作多少秒切换到保护卡片。 */
  @IsOptional() @Type(() => Number) @IsInt() @Min(30) @Max(1800)
  idleProtectionSeconds?: number;
}

/** Stage 7.4：提前结束课间。 */
export class EndClassroomBreakDto extends ClassroomRunOperationDto {}

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
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20) points?: number;
  @IsOptional() @IsEnum(RewardCategory) rewardCategory?: RewardCategory;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsEnum(RewardForm, { each: true }) rewardForms?: RewardForm[];
  @IsOptional() @IsString() @MaxLength(64) badgeCode?: string;
  @IsOptional() @IsString() @MaxLength(64) praiseTemplateId?: string;
  @IsOptional() @IsString() @MaxLength(120) praiseText?: string;
  @IsOptional() @IsBoolean() teacherConfirmedPraise?: boolean;
  @IsOptional() @IsString() @MaxLength(32) animationKey?: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class CreateGrowthGoalDto extends RequestIdDto {
  @IsString() @MinLength(1) @MaxLength(100) title: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) targetPoints: number;
}

export class CreateCollectiveRewardDto extends RequestIdDto {
  @IsEnum(RewardCategory) rewardCategory: RewardCategory;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) points: number;
  @IsString() @MinLength(1) @MaxLength(200) reason: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) goalId?: number;
}

export class RevokeRewardDto extends RequestIdDto {
  @IsString() @MinLength(1) @MaxLength(200) reason: string;
}
