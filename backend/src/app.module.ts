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
import { StageOnePlatformFoundation2026092700001 } from './migrations/202609270001-StageOnePlatformFoundation';
import { RefreshSessionTokenVersion2026092700002 } from './migrations/202609270002-RefreshSessionTokenVersion';
import { ClassroomTicketForeignKeys2026092700003 } from './migrations/202609270003-ClassroomTicketForeignKeys';
import { ResourceLibraryStageTwo2026092700004 } from './migrations/202609270004-ResourceLibraryStageTwo';
import { LessonPreparationStageThree2026092700005 } from './migrations/202609270005-LessonPreparationStageThree';
import { ClassroomRunStateMachine2026092700006 } from './migrations/202609270006-ClassroomRunStateMachine';
import { ClassroomSnapshotRecovery2026092700007 } from './migrations/202609270007-ClassroomSnapshotRecovery';
import { ClassroomRunModule } from './classroom-runs/classroom-run.module';
import { AvatarCharacterAssets2026092700008 } from './migrations/202609270008-AvatarCharacterAssets';
import { AvatarModule } from './avatars/avatar.module';
import { AvatarConfigurationBindings2026092700009 } from './migrations/202609270009-AvatarConfigurationBindings';
import { ClassroomRunStepSnapshotHints2026092700010 } from './migrations/202609270010-ClassroomRunStepSnapshotHints';
import { StudentRewardRecord2026100200011 } from './migrations/202610020011-StudentRewardRecord';
import { StudentRewardRecordIndexes2026100200012 } from './migrations/202610020012-StudentRewardRecordIndexes';
import { ClassroomRunBreakFields2026100200013 } from './migrations/202610020013-ClassroomRunBreakFields';

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
          synchronize: configService.get<string>('DB_SYNCHRONIZE') !== 'false',
          migrations: [
            StageOnePlatformFoundation2026092700001,
            RefreshSessionTokenVersion2026092700002,
            ClassroomTicketForeignKeys2026092700003,
            ResourceLibraryStageTwo2026092700004,
            LessonPreparationStageThree2026092700005,
            ClassroomRunStateMachine2026092700006,
            ClassroomSnapshotRecovery2026092700007,
            AvatarCharacterAssets2026092700008,
            AvatarConfigurationBindings2026092700009,
            ClassroomRunStepSnapshotHints2026092700010,
            StudentRewardRecord2026100200011,
            StudentRewardRecordIndexes2026100200012,
            ClassroomRunBreakFields2026100200013,
          ],
          migrationsRun:
            configService.get<string>('DB_MIGRATIONS_RUN') !== 'false',
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
