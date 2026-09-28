import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ClassroomRunStatus } from '../classroom-run.types';

@Entity({ name: 'classroom_run' })
@Index('UQ_classroom_run_active_class', ['classId'], {
  unique: true,
  where: `status IN ('prepared','running','paused')`,
})
@Index('UQ_classroom_run_active_device', ['deviceId'], {
  unique: true,
  where: `status IN ('prepared','running','paused')`,
})
export class ClassroomRun {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'lesson_plan_id', type: 'integer' })
  lessonPlanId: number;
  @Column({ name: 'lesson_plan_version', type: 'integer' })
  lessonPlanVersion: number;
  @Index() @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Index() @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Index()
  @Column({ name: 'classroom_id', type: 'integer' })
  classroomId: number;
  @Index() @Column({ name: 'device_id', type: 'integer' }) deviceId: number;
  @Index()
  @Column({ name: 'avatar_version_id', type: 'integer', nullable: true })
  avatarVersionId: number | null;
  @Column({ type: 'varchar', length: 200 }) title: string;
  @Column({
    type: 'simple-enum',
    enum: ClassroomRunStatus,
    default: ClassroomRunStatus.Prepared,
  })
  status: ClassroomRunStatus;
  @Column({ name: 'current_step_index', type: 'integer', default: 0 })
  currentStepIndex: number;
  @Column({ name: 'started_at', type: 'datetime', nullable: true })
  startedAt: Date | null;
  @Column({ name: 'paused_at', type: 'datetime', nullable: true })
  pausedAt: Date | null;
  @Column({ name: 'resumed_at', type: 'datetime', nullable: true })
  resumedAt: Date | null;
  @Column({ name: 'ended_at', type: 'datetime', nullable: true })
  endedAt: Date | null;
  @Column({ name: 'elapsed_seconds', type: 'integer', default: 0 })
  elapsedSeconds: number;
  @Column({ type: 'integer', default: 1 }) version: number;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
