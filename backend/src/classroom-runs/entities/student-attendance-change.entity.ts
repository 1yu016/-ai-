import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AttendanceStatus } from './student-attendance-record.entity';

export enum AttendanceChangeSource {
  Manual = 'manual',
  Batch = 'batch',
  VoiceConfirmed = 'voice_confirmed',
}

@Entity({ name: 'student_attendance_change' })
@Index('IDX_attendance_change_run_student', ['classroomRunId', 'studentId', 'createdAt'])
export class StudentAttendanceChange {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'attendance_record_id', type: 'integer' }) attendanceRecordId: number;
  @Column({ name: 'classroom_run_id', type: 'integer' }) classroomRunId: number;
  @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Column({ name: 'student_id', type: 'integer' }) studentId: number;
  @Column({ name: 'previous_status', type: 'simple-enum', enum: AttendanceStatus, nullable: true })
  previousStatus: AttendanceStatus | null;
  @Column({ name: 'next_status', type: 'simple-enum', enum: AttendanceStatus })
  nextStatus: AttendanceStatus;
  @Column({ name: 'changed_by_teacher_id', type: 'integer' }) changedByTeacherId: number;
  @Column({ type: 'simple-enum', enum: AttendanceChangeSource }) source: AttendanceChangeSource;
  @Column({ name: 'request_id', type: 'varchar', length: 100 }) requestId: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
