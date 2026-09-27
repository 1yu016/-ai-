import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { LessonPlanModule } from '../lesson-plans/lesson-plan.module';
import { Classroom } from '../platform/entities/classroom.entity';
import { DeviceBinding } from '../platform/entities/device-binding.entity';
import { Device } from '../platform/entities/device.entity';
import { PlatformModule } from '../platform/platform.module';
import { ResourceModule } from '../resources/resource.module';
import { ClassroomRunController } from './classroom-run.controller';
import { ClassroomRunService } from './classroom-run.service';
import { ClassroomEvent } from './entities/classroom-event.entity';
import { ClassroomRunStepSnapshot } from './entities/classroom-run-step-snapshot.entity';
import { ClassroomRun } from './entities/classroom-run.entity';
import { ClassroomSnapshot } from './entities/classroom-snapshot.entity';
import { ClassroomDeviceTransfer } from './entities/classroom-device-transfer.entity';
import { ClassroomSnapshotService } from './classroom-snapshot.service';

export const CLASSROOM_RUN_ENTITIES = [
  ClassroomRun,
  ClassroomRunStepSnapshot,
  ClassroomEvent,
  ClassroomSnapshot,
  ClassroomDeviceTransfer,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ...CLASSROOM_RUN_ENTITIES,
      DeviceBinding,
      Classroom,
      Device,
    ]),
    AuthModule,
    PlatformModule,
    LessonPlanModule,
    ResourceModule,
  ],
  controllers: [ClassroomRunController],
  providers: [ClassroomRunService, ClassroomSnapshotService],
  exports: [ClassroomRunService, ClassroomSnapshotService],
})
export class ClassroomRunModule {}
