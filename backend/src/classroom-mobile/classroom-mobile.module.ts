import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ClassroomRunModule } from '../classroom-runs/classroom-run.module';
import { ClassroomRollCallRecord } from '../classroom-runs/entities/classroom-roll-call-record.entity';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { StudentRewardRecord } from '../classroom-runs/entities/student-reward-record.entity';
import { PlatformModule } from '../platform/platform.module';
import { Device } from '../platform/entities/device.entity';
import { Student } from '../platform/entities/student.entity';
import {
  ClassroomMobileController,
  ClassroomMobileDiscoveryController,
} from './classroom-mobile.controller';
import { ClassroomMobileService } from './classroom-mobile.service';
import { ClassroomControlSession } from './entities/classroom-control-session.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ClassroomControlSession,
      ClassroomRun,
      ClassroomRollCallRecord,
      StudentRewardRecord,
      Device,
      Student,
    ]),
    AuthModule,
    PlatformModule,
    ClassroomRunModule,
  ],
  controllers: [
    ClassroomMobileController,
    ClassroomMobileDiscoveryController,
  ],
  providers: [ClassroomMobileService],
  exports: [ClassroomMobileService],
})
export class ClassroomMobileModule {}
