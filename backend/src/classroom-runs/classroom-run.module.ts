import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Teacher } from '../auth/entities/teacher.entity';
import { LessonPlanModule } from '../lesson-plans/lesson-plan.module';
import { Classroom } from '../platform/entities/classroom.entity';
import { DeviceBinding } from '../platform/entities/device-binding.entity';
import { Device } from '../platform/entities/device.entity';
import { Student } from '../platform/entities/student.entity';
import { PlatformModule } from '../platform/platform.module';
import { ResourceModule } from '../resources/resource.module';
import { ClassroomRunController } from './classroom-run.controller';
import { ClassroomRunService } from './classroom-run.service';
import { ClassroomEvent } from './entities/classroom-event.entity';
import { ClassroomRunStepSnapshot } from './entities/classroom-run-step-snapshot.entity';
import { ClassroomRun } from './entities/classroom-run.entity';
import { ClassroomSnapshot } from './entities/classroom-snapshot.entity';
import { ClassroomDeviceTransfer } from './entities/classroom-device-transfer.entity';
import { StudentRewardRecord } from './entities/student-reward-record.entity';
import { ClassroomSnapshotService } from './classroom-snapshot.service';
import { StudentRewardService } from './student-reward.service';
import { AvatarModule } from '../avatars/avatar.module';
import { BreakRun } from '../classroom-engagement/entities/break-run.entity';

export const CLASSROOM_RUN_ENTITIES = [
  ClassroomRun,
  ClassroomRunStepSnapshot,
  ClassroomEvent,
  ClassroomSnapshot,
  ClassroomDeviceTransfer,
  StudentRewardRecord,
  BreakRun,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ...CLASSROOM_RUN_ENTITIES,
      DeviceBinding,
      Classroom,
      Device,
      Student,
      Teacher,
    ]),
    AuthModule,
    PlatformModule,
    LessonPlanModule,
    ResourceModule,
    AvatarModule,
  ],
  controllers: [ClassroomRunController],
  providers: [ClassroomRunService, ClassroomSnapshotService, StudentRewardService],
  exports: [ClassroomRunService, ClassroomSnapshotService, StudentRewardService],
})
export class ClassroomRunModule {}
