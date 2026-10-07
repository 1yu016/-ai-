import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'reward_reversal' })
@Index(['teacherId', 'requestId'], { unique: true })
export class RewardReversal {
  @PrimaryGeneratedColumn() id: number;
  @Index({ unique: true })
  @Column({ name: 'reward_record_id', type: 'integer' })
  rewardRecordId: number;
  @Column({ name: 'request_id', type: 'varchar', length: 100 })
  requestId: string;
  @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ type: 'varchar', length: 300 }) reason: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
