import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RollCallMode } from '../classroom-participation.types';

@Entity({ name: 'roll_call_record' })
@Index(['classroomRunId', 'requestId'], { unique: true })
export class RollCallRecord {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;
  @Index() @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Index() @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ name: 'request_id', type: 'varchar', length: 100 })
  requestId: string;
  @Column({ type: 'simple-enum', enum: RollCallMode }) mode: RollCallMode;
  @Column({ name: 'group_id', type: 'integer', nullable: true }) groupId:
    number | null;
  @Index()
  @Column({ name: 'selected_student_id', type: 'integer' })
  selectedStudentId: number;
  @Column({ name: 'algorithm_version', type: 'varchar', length: 30 })
  algorithmVersion: string;
  @Column({ name: 'cooldown_count', type: 'integer', default: 2 })
  cooldownCount: number;
  @Column({ type: 'varchar', length: 30 }) source: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
