import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LessonStepActionType } from '../lesson-plan.types';

@Entity({ name: 'lesson_step_action' })
export class LessonStepAction {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'step_id', type: 'integer' })
  stepId: number;
  @Column({ type: 'simple-enum', enum: LessonStepActionType })
  actionType: LessonStepActionType;
  @Column({ name: 'action_name', type: 'varchar', length: 50 })
  actionName: string;
  @Column({ type: 'varchar', length: 500, nullable: true })
  content: string | null;
  @Column({ name: 'target_student_id', type: 'integer', nullable: true })
  targetStudentId: number | null;
  @Column({ name: 'sort_order', type: 'integer' }) sortOrder: number;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
