import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  ClassroomRunStatus,
  ClassroomSnapshotReason,
} from '../classroom-run.types';

@Entity({ name: 'classroom_snapshot' })
@Index(['classroomRunId', 'snapshotVersion'], { unique: true })
export class ClassroomSnapshot {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;
  @Column({ name: 'snapshot_version', type: 'integer' })
  snapshotVersion: number;
  @Column({ name: 'run_version', type: 'integer' }) runVersion: number;
  @Column({ name: 'run_status', type: 'simple-enum', enum: ClassroomRunStatus })
  runStatus: ClassroomRunStatus;
  @Column({ name: 'current_step_index', type: 'integer' })
  currentStepIndex: number;
  @Column({ name: 'elapsed_seconds', type: 'integer' })
  elapsedSeconds: number;
  @Column({ name: 'played_resource_ids', type: 'text', default: '[]' })
  playedResourceIds: string;
  @Column({ name: 'attendance_state', type: 'text', default: '{}' })
  attendanceState: string;
  @Column({ name: 'roll_call_state', type: 'text', default: '{}' })
  rollCallState: string;
  @Column({ name: 'reward_state', type: 'text', default: '{}' })
  rewardState: string;
  @Column({ name: 'interaction_state', type: 'text', default: '{}' })
  interactionState: string;
  @Column({ name: 'player_state', type: 'text', default: '{}' })
  playerState: string;
  @Column({ name: 'device_id', type: 'integer' }) deviceId: number;
  @Index()
  @Column({ name: 'avatar_version_id', type: 'integer', nullable: true })
  avatarVersionId: number | null;
  @Index()
  @Column({ name: 'avatar_character_id', type: 'integer', nullable: true })
  avatarCharacterId: number | null;
  @Column({ type: 'simple-enum', enum: ClassroomSnapshotReason })
  reason: ClassroomSnapshotReason;
  @Column({ name: 'is_key', type: 'boolean', default: false }) isKey: boolean;
  @Column({ type: 'varchar', length: 64 }) checksum: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
