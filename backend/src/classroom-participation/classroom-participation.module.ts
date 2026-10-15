import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ClassroomRunModule } from '../classroom-runs/classroom-run.module';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { PlatformModule } from '../platform/platform.module';
import { Student } from '../platform/entities/student.entity';
import {
  ClassroomParticipationController,
  StudentAttendanceController,
} from './classroom-participation.controller';
import { ClassroomParticipationService } from './classroom-participation.service';
import { CLASSROOM_PARTICIPATION_ENTITIES } from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ...CLASSROOM_PARTICIPATION_ENTITIES,
      ClassroomRun,
      Student,
    ]),
    AuthModule,
    PlatformModule,
    ClassroomRunModule,
  ],
  controllers: [ClassroomParticipationController, StudentAttendanceController],
  providers: [ClassroomParticipationService],
  exports: [ClassroomParticipationService],
})
export class ClassroomParticipationModule {}
