import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ClassroomRunModule } from '../classroom-runs/classroom-run.module';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { PlatformModule } from '../platform/platform.module';
import { Student } from '../platform/entities/student.entity';
import { ClassroomEngagementController } from './classroom-engagement.controller';
import { ClassroomEngagementService } from './classroom-engagement.service';
import { CLASSROOM_ENGAGEMENT_ENTITIES } from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ...CLASSROOM_ENGAGEMENT_ENTITIES,
      ClassroomRun,
      Student,
    ]),
    AuthModule,
    PlatformModule,
    ClassroomRunModule,
  ],
  controllers: [ClassroomEngagementController],
  providers: [ClassroomEngagementService],
  exports: [ClassroomEngagementService],
})
export class ClassroomEngagementModule {}
