import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { RewardCategory } from '../reward-system.types';

@Entity({ name: 'class_collective_reward_record' })
@Index('UQ_collective_reward_run_request', ['classroomRunId', 'requestId'], { unique: true })
export class ClassCollectiveRewardRecord {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'classroom_run_id', type: 'integer' }) classroomRunId: number;
  @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ name: 'goal_id', type: 'integer', nullable: true }) goalId: number | null;
  @Column({ name: 'reward_category', type: 'simple-enum', enum: RewardCategory }) rewardCategory: RewardCategory;
  @Column({ name: 'points', type: 'integer' }) points: number;
  @Column({ name: 'reason', type: 'varchar', length: 200 }) reason: string;
  @Column({ name: 'request_id', type: 'varchar', length: 100 }) requestId: string;
  @Column({ name: 'revoked_at', type: 'datetime', nullable: true }) revokedAt: Date | null;
  @Column({ name: 'revoked_by_teacher_id', type: 'integer', nullable: true }) revokedByTeacherId: number | null;
  @Column({ name: 'revoke_request_id', type: 'varchar', length: 100, nullable: true, unique: true }) revokeRequestId: string | null;
  @Column({ name: 'revoke_reason', type: 'varchar', length: 200, nullable: true }) revokeReason: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
