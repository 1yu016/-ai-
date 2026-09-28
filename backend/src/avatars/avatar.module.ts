import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { ClassroomSnapshot } from '../classroom-runs/entities/classroom-snapshot.entity';
import { PlatformModule } from '../platform/platform.module';
import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { AvatarUploadExceptionFilter } from './avatar-upload-exception.filter';
import { AvatarAsset } from './entities/avatar-asset.entity';
import { AvatarCharacter } from './entities/avatar-character.entity';
import { AvatarVersion } from './entities/avatar-version.entity';

export const AVATAR_ENTITIES = [AvatarCharacter, AvatarVersion, AvatarAsset];

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ...AVATAR_ENTITIES,
      ClassroomRun,
      ClassroomSnapshot,
    ]),
    AuthModule,
    PlatformModule,
  ],
  controllers: [AvatarController],
  providers: [AvatarService, AvatarUploadExceptionFilter],
  exports: [AvatarService],
})
export class AvatarModule {}
