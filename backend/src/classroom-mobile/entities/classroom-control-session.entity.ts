import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'classroom_control_session' })
@Index('UQ_classroom_control_session_token', ['tokenHash'], { unique: true })
@Index('IDX_classroom_control_session_run_teacher', [
  'classroomRunId',
  'teacherId',
])
export class ClassroomControlSession {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;

  @Column({ name: 'teacher_id', type: 'integer' })
  teacherId: number;

  @Column({ name: 'class_id', type: 'integer' })
  classId: number;

  @Column({ name: 'screen_device_id', type: 'integer' })
  screenDeviceId: number;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt: Date;

  @Column({ name: 'last_heartbeat_at', type: 'datetime', nullable: true })
  lastHeartbeatAt: Date | null;

  @Column({ name: 'revoked_at', type: 'datetime', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'revoke_reason', type: 'varchar', length: 120, nullable: true })
  revokeReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
