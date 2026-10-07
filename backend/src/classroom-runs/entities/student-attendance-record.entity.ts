import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AttendanceStatus {
  Present = 'present',
  Absent = 'absent',
  Late = 'late',
  Leave = 'leave',
}

@Entity({ name: 'student_attendance_record' })
@Index('UQ_attendance_run_student', ['classroomRunId', 'studentId'], {
  unique: true,
})
@Index('IDX_attendance_class_run', ['classId', 'classroomRunId'])
export class StudentAttendanceRecord {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'classroom_run_id', type: 'integer' }) classroomRunId: number;
  @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Column({ name: 'student_id', type: 'integer' }) studentId: number;
  @Column({ type: 'simple-enum', enum: AttendanceStatus }) status: AttendanceStatus;
  @Column({ name: 'first_status', type: 'simple-enum', enum: AttendanceStatus })
  firstStatus: AttendanceStatus;
  @Column({ name: 'first_marked_by_teacher_id', type: 'integer' })
  firstMarkedByTeacherId: number;
  @Column({ name: 'first_marked_at', type: 'datetime' }) firstMarkedAt: Date;
  @Column({ name: 'modified_by_teacher_id', type: 'integer' })
  modifiedByTeacherId: number;
  @Column({ name: 'modified_at', type: 'datetime' }) modifiedAt: Date;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
