import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class MigrateVisitorDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'visitorId 不能为空' })
  @MaxLength(128, { message: 'visitorId 最长 128 个字符' })
  visitorId: string;
}
