import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  LessonAgeGroup,
  LessonPlanStatus,
  LessonPlanType,
} from '../lesson-plan.types';
import type { LessonStep } from './lesson-step.entity';

@Entity({ name: 'lesson_plan' })
export class LessonPlan {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ name: 'school_id', type: 'varchar', length: 64, nullable: true })
  schoolId: string | null;
  @Column({ type: 'varchar', length: 200 }) title: string;
  @Column({ type: 'varchar', length: 200 }) theme: string;
  @Column({
    name: 'lesson_type',
    type: 'simple-enum',
    enum: LessonPlanType,
    default: LessonPlanType.Normal,
  })
  lessonType: LessonPlanType;
  @Column({ type: 'varchar', length: 100, nullable: true })
  domain: string | null;
  @Column({ name: 'age_group', type: 'simple-enum', enum: LessonAgeGroup })
  ageGroup: LessonAgeGroup;
  @Column({ type: 'text' }) objectives: string;
  @Column({ name: 'estimated_minutes', type: 'integer' })
  estimatedMinutes: number;
  @Column({
    type: 'simple-enum',
    enum: LessonPlanStatus,
    default: LessonPlanStatus.Draft,
  })
  status: LessonPlanStatus;
  @Column({ type: 'integer', default: 1 }) version: number;
  @Column({ name: 'current_version_id', type: 'integer', nullable: true })
  currentVersionId: number | null;
  @Column({ name: 'outline_json', type: 'text', nullable: true })
  outlineJson: string | null;
  @Column({ name: 'deleted_at', type: 'datetime', nullable: true })
  deletedAt: Date | null;
  @OneToMany('LessonStep', 'lessonPlan', { cascade: false })
  steps: LessonStep[];
  stepCount?: number;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
