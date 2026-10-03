import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PlatformModule } from '../platform/platform.module';
import { ResourceReference } from '../resources/entities/resource-reference.entity';
import { ResourceModule } from '../resources/resource.module';
import { LessonAiDraft } from './entities/lesson-ai-draft.entity';
import { LessonPlanVersion } from './entities/lesson-plan-version.entity';
import { LessonPlan } from './entities/lesson-plan.entity';
import { LessonRecoveryPoint } from './entities/lesson-recovery-point.entity';
import { LessonRun } from './entities/lesson-run.entity';
import { LessonStepAction } from './entities/lesson-step-action.entity';
import { LessonStep } from './entities/lesson-step.entity';
import { LessonPlanAiService } from './lesson-plan-ai.service';
import { LessonPlanController } from './lesson-plan.controller';
import { LessonPlanService } from './lesson-plan.service';

export const LESSON_PLAN_ENTITIES = [
  LessonPlan,
  LessonStep,
  LessonRun,
  LessonPlanVersion,
  LessonRecoveryPoint,
  LessonStepAction,
  LessonAiDraft,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([...LESSON_PLAN_ENTITIES, ResourceReference]),
    AuthModule,
    ResourceModule,
    PlatformModule,
  ],
  controllers: [LessonPlanController],
  providers: [LessonPlanService, LessonPlanAiService],
  exports: [LessonPlanService],
})
export class LessonPlanModule {}
