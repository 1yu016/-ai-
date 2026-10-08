import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum RollCallMode {
  Random = 'random',
  Specified = 'specified',
  GroupRandom = 'group_random',
}

@Entity({ name: 'classroom_roll_call_record' })
@Index('UQ_roll_call_request', ['requestId'], { unique: true })
@Index('IDX_roll_call_run_created', ['classroomRunId', 'createdAt'])
export class ClassroomRollCallRecord {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'request_id', type: 'varchar', length: 100 }) requestId: string;
  @Column({ name: 'classroom_run_id', type: 'integer' }) classroomRunId: number;
  @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Column({ name: 'student_id', type: 'integer' }) studentId: number;
  @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ type: 'simple-enum', enum: RollCallMode }) mode: RollCallMode;
  @Column({ name: 'group_key', type: 'varchar', length: 100, nullable: true }) groupKey: string | null;
  @Column({ name: 'eligible_count', type: 'integer' }) eligibleCount: number;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
