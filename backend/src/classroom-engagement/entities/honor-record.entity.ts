import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { HonorStatus, HonorType } from '../classroom-engagement.types';

@Entity({ name: 'honor_record' })
@Index(['teacherId', 'requestId'], { unique: true })
export class HonorRecord {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;
  @Index() @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Index()
  @Column({ name: 'student_id', type: 'integer', nullable: true })
  studentId: number | null;
  @Column({ type: 'simple-enum', enum: HonorType }) type: HonorType;
  @Column({ type: 'varchar', length: 120 }) title: string;
  @Column({ type: 'text', default: '{}' }) dimensions: string;
  @Column({
    type: 'simple-enum',
    enum: HonorStatus,
    default: HonorStatus.Draft,
  })
  status: HonorStatus;
  @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ name: 'request_id', type: 'varchar', length: 100 })
  requestId: string;
  @Column({ name: 'confirmed_by', type: 'integer', nullable: true })
  confirmedBy: number | null;
  @Column({ name: 'confirmed_at', type: 'datetime', nullable: true })
  confirmedAt: Date | null;
  @Column({ name: 'cooldown_until', type: 'datetime', nullable: true })
  cooldownUntil: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
