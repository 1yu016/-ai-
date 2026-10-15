import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GrowthEventType } from '../classroom-engagement.types';

@Entity({ name: 'class_growth_record' })
@Index(['classId', 'requestId'], { unique: true })
export class ClassGrowthRecord {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer', nullable: true })
  classroomRunId: number | null;
  @Index()
  @Column({ name: 'reward_record_id', type: 'integer', nullable: true })
  rewardRecordId: number | null;
  @Index()
  @Column({ name: 'goal_id', type: 'integer', nullable: true })
  goalId: number | null;
  @Column({ type: 'integer' }) delta: number;
  @Column({ name: 'balance_after', type: 'integer' }) balanceAfter: number;
  @Column({ name: 'event_type', type: 'simple-enum', enum: GrowthEventType })
  eventType: GrowthEventType;
  @Column({ type: 'varchar', length: 300 }) reason: string;
  @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ name: 'request_id', type: 'varchar', length: 100 })
  requestId: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
