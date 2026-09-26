import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ResourceModule } from '../resources/resource.module';
import { LessonPlan } from './entities/lesson-plan.entity';
import { LessonRun } from './entities/lesson-run.entity';
import { LessonStep } from './entities/lesson-step.entity';
import { LessonPlanController } from './lesson-plan.controller';
import { LessonPlanService } from './lesson-plan.service';

@Module({ imports: [TypeOrmModule.forFeature([LessonPlan, LessonStep, LessonRun]), AuthModule, ResourceModule], controllers: [LessonPlanController], providers: [LessonPlanService], exports: [LessonPlanService] })
export class LessonPlanModule {}
