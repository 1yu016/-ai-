import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { GrowthGoalStatus } from '../reward-system.types';

@Entity({ name: 'class_growth_goal' })
@Index('IDX_class_growth_goal_class_status', ['classId', 'status'])
export class ClassGrowthGoal {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Column({ name: 'title', type: 'varchar', length: 100 }) title: string;
  @Column({ name: 'target_points', type: 'integer' }) targetPoints: number;
  @Column({ name: 'current_points', type: 'integer', default: 0 }) currentPoints: number;
  @Column({ type: 'simple-enum', enum: GrowthGoalStatus, default: GrowthGoalStatus.Active }) status: GrowthGoalStatus;
  @Column({ name: 'created_by_teacher_id', type: 'integer' }) createdByTeacherId: number;
  @Column({ name: 'completed_at', type: 'datetime', nullable: true }) completedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
