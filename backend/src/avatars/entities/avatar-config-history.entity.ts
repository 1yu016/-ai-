import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuthUserType } from '../../auth/entities/refresh-token-session.entity';
import { AvatarBindingScope } from '../avatar.types';

@Entity({ name: 'avatar_config_history' })
export class AvatarConfigHistory {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'character_id', type: 'integer', nullable: true })
  characterId: number | null;
  @Column({
    name: 'scope_type',
    type: 'simple-enum',
    enum: AvatarBindingScope,
    nullable: true,
  })
  scopeType: AvatarBindingScope | null;
  @Column({ name: 'scope_id', type: 'integer', nullable: true }) scopeId:
    number | null;
  @Column({ name: 'operator_type', type: 'simple-enum', enum: AuthUserType })
  operatorType: AuthUserType;
  @Column({ name: 'operator_id', type: 'integer' }) operatorId: number;
  @Column({ name: 'before_summary', type: 'text', nullable: true })
  beforeSummary: string | null;
  @Column({ name: 'after_summary', type: 'text', nullable: true })
  afterSummary: string | null;
  @Column({ type: 'varchar', length: 500 }) reason: string;
  @Index()
  @Column({ name: 'class_id', type: 'integer', nullable: true })
  classId: number | null;
  @Index()
  @Column({ name: 'lesson_plan_id', type: 'integer', nullable: true })
  lessonPlanId: number | null;
  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer', nullable: true })
  classroomRunId: number | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
