import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  BreakType,
  HonorType,
  RewardType,
} from '../classroom-engagement.types';

export class CreateBadgeDefinitionDto {
  @IsString() @Length(2, 64) code: string;
  @IsString() @Length(1, 100) name: string;
  @IsEnum(RewardType) rewardType: RewardType;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsString() @MaxLength(100) iconKey?: string;
}

export class CreateRewardRuleDto {
  @IsString() @Length(1, 100) name: string;
  @IsEnum(RewardType) rewardType: RewardType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) pointsValue = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20) flowerCount = 0;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  classGrowthValue = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) badgeDefinitionId?: number;
}

export class UpdateRewardRuleDto {
  @IsOptional() @IsString() @Length(1, 100) name?: string;
  @IsOptional() @IsEnum(RewardType) rewardType?: RewardType;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  pointsValue?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  flowerCount?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  classGrowthValue?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) badgeDefinitionId?:
    number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class AwardRewardDto {
  @Type(() => Number) @IsInt() @Min(1) studentId: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) ruleId?: number;
  @IsOptional() @IsEnum(RewardType) rewardType?: RewardType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) points = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20) flowerCount = 0;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  classGrowthValue = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) badgeDefinitionId?: number;
  @IsString() @Length(1, 300) reason: string;
  @IsString() @Length(8, 100) requestId: string;
}

export class ReverseRewardDto {
  @IsString() @Length(1, 300) reason: string;
  @IsString() @Length(8, 100) requestId: string;
}

export class CreateCollectiveGoalDto {
  @IsString() @Length(1, 120) title: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) targetValue: number;
}

export class AdjustClassGrowthDto {
  @Type(() => Number) @IsInt() @Min(-10000) @Max(10000) delta: number;
  @IsString() @Length(1, 300) reason: string;
  @IsString() @Length(8, 100) requestId: string;
}

export class SuggestHonorDto {
  @IsEnum(HonorType) type: HonorType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) cooldownDays = 7;
  @IsString() @Length(8, 100) requestId: string;
}

export class PublishHonorDto {
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @IsString() @Length(8, 100) requestId: string;
}

export class CreateBreakConfigDto {
  @Type(() => Number) @IsInt() @Min(1) classId: number;
  @IsEnum(BreakType) type: BreakType;
  @IsString() @Length(1, 100) name: string;
  @Type(() => Number) @IsInt() @Min(30) @Max(3600) durationSeconds: number;
  @IsOptional() @IsString() @MaxLength(500) instructions?: string;
}

export class UpdateBreakConfigDto {
  @IsOptional() @IsEnum(BreakType) type?: BreakType;
  @IsOptional() @IsString() @Length(1, 100) name?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(3600)
  durationSeconds?: number;
  @IsOptional() @IsString() @MaxLength(500) instructions?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class StartBreakDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) configId?: number;
  @IsOptional() @IsEnum(BreakType) type?: BreakType;
  @IsOptional() @IsString() @Length(1, 100) title?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(3600)
  durationSeconds?: number;
  @Type(() => Number) @IsInt() @Min(1) deviceId: number;
  @Type(() => Number) @IsInt() @Min(1) version: number;
  @IsString() @Length(8, 100) requestId: string;
}

export class BreakOperationDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
  @IsString() @Length(8, 100) requestId: string;
}
