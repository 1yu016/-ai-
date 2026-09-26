import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: '账号不能为空' })
  @MaxLength(64, { message: '账号最长 64 个字符' })
  account: string;

  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  @MaxLength(128, { message: '密码最长 128 个字符' })
  password: string;
}
