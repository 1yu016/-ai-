import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RewardType } from '../classroom-engagement.types';

@Entity({ name: 'reward_rule' })
@Index(['schoolId', 'name'], { unique: true })
export class RewardRule {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'school_id', type: 'varchar', length: 64, nullable: true })
  schoolId: string | null;
  @Column({ type: 'varchar', length: 100 }) name: string;
  @Column({ name: 'reward_type', type: 'simple-enum', enum: RewardType })
  rewardType: RewardType;
  @Column({ name: 'points_value', type: 'integer', default: 0 })
  pointsValue: number;
  @Column({ name: 'flower_count', type: 'integer', default: 0 })
  flowerCount: number;
  @Column({ name: 'class_growth_value', type: 'integer', default: 0 })
  classGrowthValue: number;
  @Index()
  @Column({ name: 'badge_definition_id', type: 'integer', nullable: true })
  badgeDefinitionId: number | null;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @Column({ name: 'created_by', type: 'integer' }) createdBy: number;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
