import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceInfo?: string;
}

export class LogoutDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken: string;
}
