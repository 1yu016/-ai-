import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  AvatarActionName,
  AvatarBindingScope,
  AvatarFallbackLevel,
} from '../avatar.types';

@Entity({ name: 'avatar_usage_log' })
export class AvatarUsageLog {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer', nullable: true })
  classroomRunId: number | null;
  @Column({ name: 'teacher_id', type: 'integer', nullable: true }) teacherId:
    number | null;
  @Column({
    name: 'source_scope',
    type: 'simple-enum',
    enum: AvatarBindingScope,
    nullable: true,
  })
  sourceScope: AvatarBindingScope | null;
  @Column({ name: 'requested_character_id', type: 'integer', nullable: true })
  requestedCharacterId: number | null;
  @Column({ name: 'effective_character_id', type: 'integer', nullable: true })
  effectiveCharacterId: number | null;
  @Column({ name: 'effective_version_id', type: 'integer', nullable: true })
  effectiveVersionId: number | null;
  @Column({
    name: 'requested_action',
    type: 'simple-enum',
    enum: AvatarActionName,
    nullable: true,
  })
  requestedAction: AvatarActionName | null;
  @Column({
    name: 'effective_action',
    type: 'simple-enum',
    enum: AvatarActionName,
    nullable: true,
  })
  effectiveAction: AvatarActionName | null;
  @Column({
    name: 'fallback_level',
    type: 'simple-enum',
    enum: AvatarFallbackLevel,
    default: AvatarFallbackLevel.None,
  })
  fallbackLevel: AvatarFallbackLevel;
  @Column({ type: 'text', nullable: true }) reason: string | null;
  @Column({ type: 'text', default: '{}' }) detail: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
