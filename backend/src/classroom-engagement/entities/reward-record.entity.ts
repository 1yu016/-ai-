import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RewardRecordStatus, RewardType } from '../classroom-engagement.types';

@Entity({ name: 'reward_record' })
@Index(['teacherId', 'requestId'], { unique: true })
export class RewardRecord {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;
  @Index() @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Index()
  @Column({ name: 'student_id', type: 'integer', nullable: true })
  studentId: number | null;
  @Index() @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Index()
  @Column({ name: 'rule_id', type: 'integer', nullable: true })
  ruleId: number | null;
  @Column({ name: 'reward_type', type: 'simple-enum', enum: RewardType })
  rewardType: RewardType;
  @Column({ type: 'integer', default: 0 }) points: number;
  @Column({ name: 'flower_count', type: 'integer', default: 0 })
  flowerCount: number;
  @Column({ name: 'class_growth_value', type: 'integer', default: 0 })
  classGrowthValue: number;
  @Index()
  @Column({ name: 'badge_definition_id', type: 'integer', nullable: true })
  badgeDefinitionId: number | null;
  @Column({ type: 'varchar', length: 300 }) reason: string;
  @Column({
    type: 'simple-enum',
    enum: RewardRecordStatus,
    default: RewardRecordStatus.Active,
  })
  status: RewardRecordStatus;
  @Column({ name: 'request_id', type: 'varchar', length: 100 })
  requestId: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
