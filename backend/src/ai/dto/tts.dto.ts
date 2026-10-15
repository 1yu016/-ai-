import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** POST /ai/tts 请求体 */
export class TtsDto {
  @IsString({ message: 'text 必须是字符串' })
  @IsNotEmpty({ message: 'text 不能为空' })
  @MaxLength(3000, { message: 'text 最长 3000 个字符' })
  text: string;
}
