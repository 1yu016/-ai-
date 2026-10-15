import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'student_badge' })
export class StudentBadge {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'student_id', type: 'integer' }) studentId: number;
  @Index()
  @Column({ name: 'badge_definition_id', type: 'integer' })
  badgeDefinitionId: number;
  @Index({ unique: true })
  @Column({ name: 'reward_record_id', type: 'integer' })
  rewardRecordId: number;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @CreateDateColumn({ name: 'awarded_at', type: 'datetime' }) awardedAt: Date;
  @Column({ name: 'reversed_at', type: 'datetime', nullable: true })
  reversedAt: Date | null;
}
