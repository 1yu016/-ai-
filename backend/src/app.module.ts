import { UNIFIED_MIGRATIONS } from './migrations/unified-migrations';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { DataModule } from './data/data.module';
import { ResourceModule } from './resources/resource.module';
import { LessonPlanModule } from './lesson-plans/lesson-plan.module';
import { PlatformModule } from './platform/platform.module';
import { ClassroomRunModule } from './classroom-runs/classroom-run.module';
import { AvatarModule } from './avatars/avatar.module';
import { ClassroomParticipationModule } from './classroom-participation/classroom-participation.module';
import { ClassroomEngagementModule } from './classroom-engagement/classroom-engagement.module';
import { ArtworkModule } from './artworks/artwork.module';
import { ClassroomMobileModule } from './classroom-mobile/classroom-mobile.module';
import { DeviceSessionModule } from './device-session/device-session.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            name: 'public',
            ttl: Number(
              configService.get<string>('PUBLIC_RATE_TTL_MS') || '60000',
            ),
            limit: Number(
              configService.get<string>('PUBLIC_RATE_LIMIT') || '20',
            ),
          },
        ],
        errorMessage: '请求过于频繁，请稍后再试',
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (
        configService: ConfigService,
      ): Promise<TypeOrmModuleOptions> => {
        const database =
          configService.get<string>('DATABASE_PATH')?.trim() ||
          join(process.cwd(), 'data', 'app.sqlite');
        await mkdir(dirname(database), { recursive: true });

        return {
          type: 'better-sqlite3' as const,
          database,
          autoLoadEntities: true,
          synchronize: configService.get<string>('DB_SYNCHRONIZE') === 'true',
          migrations: UNIFIED_MIGRATIONS,
          migrationsRun:
            configService.get<string>('DB_MIGRATIONS_RUN') === 'true',
        };
      },
    }),
    AuthModule,
    DataModule,
    ResourceModule,
    AiModule,
    LessonPlanModule,
    PlatformModule,
    ClassroomRunModule,
    AvatarModule,
    ClassroomParticipationModule,
    ClassroomEngagementModule,
    ArtworkModule,
    ClassroomMobileModule,
    DeviceSessionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
