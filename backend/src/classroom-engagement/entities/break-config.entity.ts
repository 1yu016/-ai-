import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BreakType } from '../classroom-engagement.types';

@Entity({ name: 'break_config' })
export class BreakConfig {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Column({ type: 'simple-enum', enum: BreakType }) type: BreakType;
  @Column({ type: 'varchar', length: 100 }) name: string;
  @Column({ name: 'duration_seconds', type: 'integer' })
  durationSeconds: number;
  @Column({ type: 'varchar', length: 500, nullable: true }) instructions:
    string | null;
  @Column({ type: 'boolean', default: true }) enabled: boolean;
  @Column({ name: 'created_by', type: 'integer' }) createdBy: number;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
