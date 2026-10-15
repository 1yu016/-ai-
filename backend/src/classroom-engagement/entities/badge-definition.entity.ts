import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RewardType } from '../classroom-engagement.types';

@Entity({ name: 'badge_definition' })
@Index(['schoolId', 'code'], { unique: true })
export class BadgeDefinition {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'school_id', type: 'varchar', length: 64, nullable: true })
  schoolId: string | null;
  @Column({ type: 'varchar', length: 64 }) code: string;
  @Column({ type: 'varchar', length: 100 }) name: string;
  @Column({ name: 'reward_type', type: 'simple-enum', enum: RewardType })
  rewardType: RewardType;
  @Column({ type: 'varchar', length: 300, nullable: true }) description:
    string | null;
  @Column({ name: 'icon_key', type: 'varchar', length: 100, nullable: true })
  iconKey: string | null;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @Column({ name: 'created_by', type: 'integer' }) createdBy: number;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
