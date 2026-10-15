import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ClassroomRunModule } from '../classroom-runs/classroom-run.module';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { GuardianConsent } from '../platform/entities/guardian-consent.entity';
import { Student } from '../platform/entities/student.entity';
import { PlatformModule } from '../platform/platform.module';
import { ArtworkController } from './artwork.controller';
import { ArtworkService } from './artwork.service';
import { ArtworkVisionService } from './artwork-vision.service';
import { StudentArtworkRecord } from './entities/student-artwork-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([StudentArtworkRecord, ClassroomRun, Student, GuardianConsent]), AuthModule, PlatformModule, ClassroomRunModule],
  controllers: [ArtworkController],
  providers: [ArtworkService, ArtworkVisionService],
  exports: [ArtworkService, TypeOrmModule],
})
export class ArtworkModule {}
