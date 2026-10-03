import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AvatarModule } from '../avatars/avatar.module';
import { ClassroomEvent } from '../classroom-runs/entities/classroom-event.entity';
import { ClassroomRunStepSnapshot } from '../classroom-runs/entities/classroom-run-step-snapshot.entity';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { ClassroomSnapshot } from '../classroom-runs/entities/classroom-snapshot.entity';
import { DataModule } from '../data/data.module';
import { LessonPlanVersion } from '../lesson-plans/entities/lesson-plan-version.entity';
import { LessonPlan } from '../lesson-plans/entities/lesson-plan.entity';
import { PlatformModule } from '../platform/platform.module';
import { ResourceModule } from '../resources/resource.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AudioService } from './audio.service';
import { ClassroomDirectorService } from './classroom-director.service';
import { ClassroomDirectorSuggestion } from './entities/classroom-director-suggestion.entity';
import { HeuristicAssistantDraft } from './entities/heuristic-assistant-draft.entity';
import { HeuristicAssistantService } from './heuristic-assistant.service';
import { ClassroomRunModule } from '../classroom-runs/classroom-run.module';
import { Student } from '../platform/entities/student.entity';
import { ClassroomCommandService } from './classroom-command.service';
import { ClassroomCommandRecord } from './entities/classroom-command-record.entity';
import { ClassroomCommandRule } from './entities/classroom-command-rule.entity';
import { ClassroomCommandOfflineLog } from './entities/classroom-command-offline-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ClassroomDirectorSuggestion,
      ClassroomRun,
      ClassroomRunStepSnapshot,
      ClassroomEvent,
      ClassroomSnapshot,
      HeuristicAssistantDraft,
      LessonPlan,
      LessonPlanVersion,
      Student,
      ClassroomCommandRecord,
      ClassroomCommandRule,
      ClassroomCommandOfflineLog,
    ]),
    AuthModule,
    DataModule,
    ResourceModule,
    PlatformModule,
    AvatarModule,
    ClassroomRunModule,
  ],
  controllers: [AiController],
  providers: [
    AiService,
    AudioService,
    ClassroomDirectorService,
    HeuristicAssistantService,
    ClassroomCommandService,
  ],
})
export class AiModule {}
