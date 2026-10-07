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
import { ClassroomCommandRecord } from './entities/classroom-command-record.entity';
import { ClassroomCommandController } from './classroom-command.controller';
import { ClassroomCommandService } from './classroom-command.service';
import { StudentAttendanceRecord } from './entities/student-attendance-record.entity';
import { StudentAttendanceChange } from './entities/student-attendance-change.entity';
import { ClassroomRollCallRecord } from './entities/classroom-roll-call-record.entity';
import { AttendanceService } from './attendance.service';
import { ClassGrowthGoal } from './entities/class-growth-goal.entity';
import { ClassCollectiveRewardRecord } from './entities/class-collective-reward-record.entity';
import { StudentQuestionRecord } from './entities/student-question-record.entity';
import { StudentQuestionController } from './student-question.controller';
import { StudentQuestionService } from './student-question.service';
import { QuestionMapAiService } from './question-map-ai.service';
import { ClassroomSummaryDraft } from './entities/classroom-summary-draft.entity';
import { ClassroomSummary } from './entities/classroom-summary.entity';
import { ClassroomDirectorSuggestion } from '../ai/entities/classroom-director-suggestion.entity';
import { AuditLog } from '../platform/entities/audit-log.entity';
import { ClassroomRecordController } from './classroom-record.controller';
import { ClassroomRecordService } from './classroom-record.service';
import { ClassroomSummaryAiService } from './classroom-summary-ai.service';
import { StudentArtworkRecord } from '../artworks/entities/student-artwork-record.entity';

export const CLASSROOM_RUN_ENTITIES = [
  ClassroomRun,
  ClassroomRunStepSnapshot,
  ClassroomEvent,
  ClassroomSnapshot,
  ClassroomDeviceTransfer,
  StudentRewardRecord,
  ClassroomCommandRecord,
  StudentAttendanceRecord,
  StudentAttendanceChange,
  ClassroomRollCallRecord,
  ClassGrowthGoal,
  ClassCollectiveRewardRecord,
  StudentQuestionRecord,
  ClassroomSummaryDraft,
  ClassroomSummary,
  ClassroomDirectorSuggestion,
  StudentArtworkRecord,
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
      AuditLog,
    ]),
    AuthModule,
    PlatformModule,
    LessonPlanModule,
    ResourceModule,
    AvatarModule,
  ],
  controllers: [
    ClassroomRunController,
    ClassroomCommandController,
    StudentQuestionController,
    ClassroomRecordController,
  ],
  providers: [
    ClassroomRunService,
    ClassroomSnapshotService,
    StudentRewardService,
    ClassroomCommandService,
    AttendanceService,
    StudentQuestionService,
    QuestionMapAiService,
    ClassroomRecordService,
    ClassroomSummaryAiService,
  ],
  exports: [
    ClassroomRunService,
    ClassroomSnapshotService,
    StudentRewardService,
    ClassroomCommandService,
    AttendanceService,
    StudentQuestionService,
    ClassroomRecordService,
  ],
})
export class ClassroomRunModule {}
