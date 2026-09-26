import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LessonAgeGroup, LessonPlanStatus } from '../lesson-plan.types';
import type { LessonStep } from './lesson-step.entity';

@Entity({ name: 'lesson_plan' })
export class LessonPlan {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ type: 'varchar', length: 200 }) title: string;
  @Column({ type: 'varchar', length: 200 }) theme: string;
  @Column({ name: 'age_group', type: 'simple-enum', enum: LessonAgeGroup }) ageGroup: LessonAgeGroup;
  @Column({ type: 'text' }) objectives: string;
  @Column({ name: 'estimated_minutes', type: 'integer' }) estimatedMinutes: number;
  @Column({ type: 'simple-enum', enum: LessonPlanStatus, default: LessonPlanStatus.Draft }) status: LessonPlanStatus;
  @Column({ type: 'integer', default: 1 }) version: number;
  @OneToMany('LessonStep', 'lessonPlan', { cascade: false }) steps: LessonStep[];
  stepCount?: number;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
