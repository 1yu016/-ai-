import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** 一条历史对话消息（只接受用户与助教两种角色） */
export class ChatMessageDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @IsNotEmpty({ message: '历史消息内容不能为空' })
  @MaxLength(2000)
  content: string;
}

/** POST /ai/chat 请求体 */
export class ChatDto {
  @IsString()
  @IsNotEmpty({ message: 'text 不能为空' })
  @MaxLength(2000, { message: 'text 最长 2000 个字符' })
  text: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50, { message: 'history 最多携带 50 条历史消息' })
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];

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
