import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { LessonRunStatus } from '../lesson-plan.types';

@Entity({ name: 'lesson_run' })
export class LessonRun {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'lesson_plan_id', type: 'integer' }) lessonPlanId: number;
  @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ type: 'simple-enum', enum: LessonRunStatus, default: LessonRunStatus.Running }) status: LessonRunStatus;
  @Column({ name: 'current_step_order', type: 'integer' }) currentStepOrder: number;
  @Column({ name: 'lesson_title', type: 'varchar', length: 200 }) lessonTitle: string;
  @Column({ name: 'lesson_objectives', type: 'text' }) lessonObjectives: string;
  @Column({ name: 'age_group', type: 'varchar', length: 10 }) ageGroup: string;
  @Column({ name: 'steps_snapshot', type: 'text' }) stepsSnapshot: string;
  @Column({ name: 'elapsed_seconds', type: 'integer', default: 0 }) elapsedSeconds: number;
  @Column({ name: 'resumed_at', type: 'datetime', nullable: true }) resumedAt: Date | null;
  @Column({ name: 'started_at', type: 'datetime' }) startedAt: Date;
  @Column({ name: 'ended_at', type: 'datetime', nullable: true }) endedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
