import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AttendanceStatus } from '../classroom-participation.types';

@Entity({ name: 'attendance_record' })
@Index(['classroomRunId', 'studentId'], { unique: true })
export class AttendanceRecord {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;
  @Index() @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Index() @Column({ name: 'student_id', type: 'integer' }) studentId: number;
  @Column({ type: 'simple-enum', enum: AttendanceStatus })
  status: AttendanceStatus;
  @Column({ type: 'varchar', length: 300, nullable: true }) note: string | null;
  @Column({ name: 'updated_by', type: 'integer' }) updatedBy: number;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
