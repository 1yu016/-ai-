import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ReportEmotionDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'visitorId 不能为空' })
  @MaxLength(128, { message: 'visitorId 最长 128 个字符' })
  visitorId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sessionId?: number;

  @IsString()
  @IsNotEmpty({ message: 'emotion 不能为空' })
  @MaxLength(50)
  emotion: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  intensity?: number;
}
