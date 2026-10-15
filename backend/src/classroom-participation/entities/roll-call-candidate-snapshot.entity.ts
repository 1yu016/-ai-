import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'roll_call_candidate_snapshot' })
@Index(['rollCallRecordId', 'studentId'], { unique: true })
export class RollCallCandidateSnapshot {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'roll_call_record_id', type: 'integer' })
  rollCallRecordId: number;
  @Index() @Column({ name: 'student_id', type: 'integer' }) studentId: number;
  @Column({ type: 'boolean' }) eligible: boolean;
  @Column({
    name: 'exclusion_reason',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  exclusionReason: string | null;
  @Column({ name: 'recent_call_count', type: 'integer', default: 0 })
  recentCallCount: number;
  @Column({ name: 'total_call_count', type: 'integer', default: 0 })
  totalCallCount: number;
  @Column({ name: 'last_called_at', type: 'datetime', nullable: true })
  lastCalledAt: Date | null;
  @Column({ type: 'boolean', default: false }) selected: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
