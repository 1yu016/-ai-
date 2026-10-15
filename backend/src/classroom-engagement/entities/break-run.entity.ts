import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BreakRunStatus, BreakType } from '../classroom-engagement.types';

@Entity({ name: 'break_run' })
@Index('UQ_break_run_active_classroom', ['classroomRunId'], {
  unique: true,
  where: `status IN ('running','paused')`,
})
@Index(['teacherId', 'requestId'], { unique: true })
export class BreakRun {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;
  @Index() @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Column({ name: 'config_id', type: 'integer', nullable: true }) configId:
    number | null;
  @Column({ type: 'simple-enum', enum: BreakType }) type: BreakType;
  @Column({ type: 'varchar', length: 100 }) title: string;
  @Column({ name: 'duration_seconds', type: 'integer' })
  durationSeconds: number;
  @Column({
    type: 'simple-enum',
    enum: BreakRunStatus,
    default: BreakRunStatus.Running,
  })
  status: BreakRunStatus;
  @Column({ name: 'saved_run_status', type: 'varchar', length: 30 })
  savedRunStatus: string;
  @Column({ name: 'saved_step_index', type: 'integer' }) savedStepIndex: number;
  @Column({ name: 'saved_run_version', type: 'integer' })
  savedRunVersion: number;
  @Column({ name: 'elapsed_seconds', type: 'integer', default: 0 })
  elapsedSeconds: number;
  @Column({ name: 'started_at', type: 'datetime' }) startedAt: Date;
  @Column({ name: 'resumed_at', type: 'datetime', nullable: true })
  resumedAt: Date | null;
  @Column({ name: 'paused_at', type: 'datetime', nullable: true })
  pausedAt: Date | null;
  @Column({ name: 'ended_at', type: 'datetime', nullable: true })
  endedAt: Date | null;
  @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ name: 'request_id', type: 'varchar', length: 100 })
  requestId: string;
  @Column({ type: 'integer', default: 1 }) version: number;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
