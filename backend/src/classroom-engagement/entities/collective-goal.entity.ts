import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CollectiveGoalStatus } from '../classroom-engagement.types';

@Entity({ name: 'collective_goal' })
export class CollectiveGoal {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Column({ type: 'varchar', length: 120 }) title: string;
  @Column({ type: 'varchar', length: 500, nullable: true }) description:
    string | null;
  @Column({ name: 'target_value', type: 'integer' }) targetValue: number;
  @Column({ name: 'current_value', type: 'integer', default: 0 })
  currentValue: number;
  @Column({
    type: 'simple-enum',
    enum: CollectiveGoalStatus,
    default: CollectiveGoalStatus.Active,
  })
  status: CollectiveGoalStatus;
  @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ name: 'completed_at', type: 'datetime', nullable: true })
  completedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
