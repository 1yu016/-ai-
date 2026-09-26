import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class VoiceChatDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'visitorId 不能为空' })
  @MaxLength(128, { message: 'visitorId 最长 128 个字符' })
  visitorId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sessionId?: number;
}
