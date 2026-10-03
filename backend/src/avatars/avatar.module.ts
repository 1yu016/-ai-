import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { ClassroomSnapshot } from '../classroom-runs/entities/classroom-snapshot.entity';
import { PlatformModule } from '../platform/platform.module';
import { LessonPlan } from '../lesson-plans/entities/lesson-plan.entity';
import { AvatarController } from './avatar.controller';
import { AvatarConfigurationService } from './avatar-configuration.service';
import { AvatarService } from './avatar.service';
import { AvatarUploadExceptionFilter } from './avatar-upload-exception.filter';
import { AvatarAsset } from './entities/avatar-asset.entity';
import { AvatarCharacter } from './entities/avatar-character.entity';
import { AvatarVersion } from './entities/avatar-version.entity';
import { AvatarBinding } from './entities/avatar-binding.entity';
import { AvatarConfigHistory } from './entities/avatar-config-history.entity';
import { AvatarPersonality } from './entities/avatar-personality.entity';
import { AvatarUsageLog } from './entities/avatar-usage-log.entity';
import { AvatarVoiceProfile } from './entities/avatar-voice-profile.entity';

export const AVATAR_ENTITIES = [
  AvatarCharacter,
  AvatarVersion,
  AvatarAsset,
  AvatarVoiceProfile,
  AvatarPersonality,
  AvatarBinding,
  AvatarConfigHistory,
  AvatarUsageLog,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ...AVATAR_ENTITIES,
      ClassroomRun,
      ClassroomSnapshot,
      LessonPlan,
    ]),
    AuthModule,
    PlatformModule,
  ],
  controllers: [AvatarController],
  providers: [
    AvatarService,
    AvatarConfigurationService,
    AvatarUploadExceptionFilter,
  ],
  exports: [AvatarService, AvatarConfigurationService],
})
export class AvatarModule {}
