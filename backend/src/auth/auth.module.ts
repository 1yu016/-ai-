import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { Teacher } from './entities/teacher.entity';
import { OptionalAuthGuard } from './optional-auth.guard';
import { TeacherSeederService } from './teacher-seeder.service';

function parseJwtExpiresIn(value: string): number {
  const match = /^(\d+)([smhd])?$/.exec(value.trim().toLowerCase());
  if (!match) {
    throw new Error('JWT_EXPIRES_IN 格式错误，请使用 7200、120m 或 2h');
  }

  const amount = Number(match[1]);
  const unitSeconds = { s: 1, m: 60, h: 3600, d: 86400 } as const;
  const unit = (match[2] || 's') as keyof typeof unitSeconds;
  return amount * unitSeconds[unit];
}

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Teacher]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET')?.trim();
        if (!secret) {
          throw new Error('缺少环境变量 JWT_SECRET');
        }

        return {
          secret,
          signOptions: {
            expiresIn: parseJwtExpiresIn(
              configService.get<string>('JWT_EXPIRES_IN') || '2h',
            ),
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, OptionalAuthGuard, TeacherSeederService],
  exports: [AuthGuard, OptionalAuthGuard, JwtModule],
})
export class AuthModule {}
