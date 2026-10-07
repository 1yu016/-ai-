import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuthUserType } from '../../auth/entities/refresh-token-session.entity';
import {
  AttendanceChangeSource,
  AttendanceStatus,
} from '../classroom-participation.types';

@Entity({ name: 'attendance_change_log' })
@Index(['classroomRunId', 'studentId', 'requestId'], { unique: true })
export class AttendanceChangeLog {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'attendance_record_id', type: 'integer' })
  attendanceRecordId: number;
  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;
  @Index() @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Index() @Column({ name: 'student_id', type: 'integer' }) studentId: number;
  @Column({
    name: 'previous_status',
    type: 'simple-enum',
    enum: AttendanceStatus,
    nullable: true,
  })
  previousStatus: AttendanceStatus | null;
  @Column({ name: 'new_status', type: 'simple-enum', enum: AttendanceStatus })
  newStatus: AttendanceStatus;
  @Column({ type: 'simple-enum', enum: AttendanceChangeSource })
  source: AttendanceChangeSource;
  @Column({ name: 'actor_type', type: 'simple-enum', enum: AuthUserType })
  actorType: AuthUserType;
  @Column({ name: 'actor_id', type: 'integer' }) actorId: number;
  @Column({ name: 'request_id', type: 'varchar', length: 100 })
  requestId: string;
  @Index({ unique: true })
  @Column({
    name: 'confirmation_token_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  confirmationTokenHash: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) reason:
    string | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
