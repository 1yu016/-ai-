import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { LessonStepType } from '../lesson-plan.types';
import type { LessonPlan } from './lesson-plan.entity';

@Entity({ name: 'lesson_step' })
export class LessonStep {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'lesson_plan_id', type: 'integer' }) lessonPlanId: number;
  @ManyToOne('LessonPlan', 'steps', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lesson_plan_id' }) lessonPlan: LessonPlan;
  @Column({ name: 'sort_order', type: 'integer' }) sortOrder: number;
  @Column({ type: 'varchar', length: 200 }) title: string;
  @Column({ name: 'step_type', type: 'simple-enum', enum: LessonStepType }) stepType: LessonStepType;
  @Column({ type: 'text' }) instruction: string;
  @Column({ name: 'expected_response', type: 'text', nullable: true }) expectedResponse: string | null;
  @Column({ name: 'teacher_tip', type: 'text', nullable: true }) teacherTip: string | null;
  @Column({ name: 'resource_id', type: 'integer', nullable: true }) resourceId: number | null;
  @Column({ name: 'duration_seconds', type: 'integer' }) durationSeconds: number;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
