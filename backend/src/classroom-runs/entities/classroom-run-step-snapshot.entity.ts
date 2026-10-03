import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LessonStepType } from '../../lesson-plans/lesson-plan.types';

@Entity({ name: 'classroom_run_step_snapshot' })
@Index(['classroomRunId', 'stepIndex'], { unique: true })
export class ClassroomRunStepSnapshot {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;
  @Column({ name: 'original_step_id', type: 'integer' }) originalStepId: number;
  @Column({ name: 'step_index', type: 'integer' }) stepIndex: number;
  @Column({ type: 'varchar', length: 200 }) title: string;
  @Column({ type: 'simple-enum', enum: LessonStepType }) type: LessonStepType;
  @Column({ type: 'text' }) content: string;
  @Column({ name: 'duration_seconds', type: 'integer' })
  durationSeconds: number;
  @Column({ name: 'resource_id', type: 'integer', nullable: true })
  resourceId: number | null;
  @Column({ name: 'action_config', type: 'text', nullable: true })
  actionConfig: string | null;
  @Column({ name: 'recovery_point_config', type: 'text', nullable: true })
  recoveryPointConfig: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
