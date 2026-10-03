import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LessonRecoveryTrigger } from '../lesson-plan.types';

@Entity({ name: 'lesson_recovery_point' })
export class LessonRecoveryPoint {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'lesson_plan_id', type: 'integer' })
  lessonPlanId: number;
  @Index({ unique: true })
  @Column({ name: 'step_id', type: 'integer' })
  stepId: number;
  @Column({ type: 'varchar', length: 100 }) name: string;
  @Column({ type: 'simple-enum', enum: LessonRecoveryTrigger })
  trigger: LessonRecoveryTrigger;
  @Column({ name: 'recovery_step_order', type: 'integer' })
  recoveryStepOrder: number;
  @Column({ type: 'varchar', length: 500, nullable: true })
  prompt: string | null;
  @Column({ type: 'boolean', default: true }) enabled: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
