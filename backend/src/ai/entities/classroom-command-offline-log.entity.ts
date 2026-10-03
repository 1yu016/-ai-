import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  ClassroomCommandV2Intent,
  OfflineCommandResult,
} from '../dto/classroom-command-v2.dto';

@Entity({ name: 'classroom_command_offline_log' })
@Index(['teacherId', 'localEventId'], { unique: true })
export class ClassroomCommandOfflineLog {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;
  @Index() @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ name: 'local_event_id', type: 'varchar', length: 100 })
  localEventId: string;
  @Column({ name: 'text_hash', type: 'varchar', length: 64 }) textHash: string;
  @Column({ type: 'simple-enum', enum: ClassroomCommandV2Intent })
  intent: ClassroomCommandV2Intent;
  @Column({ type: 'text', default: '{}' }) parameters: string;
  @Column({ name: 'rule_version', type: 'integer' }) ruleVersion: number;
  @Column({ type: 'simple-enum', enum: OfflineCommandResult })
  result: OfflineCommandResult;
  @Column({ name: 'error_code', type: 'varchar', length: 100, nullable: true })
  errorCode: string | null;
  @Column({ name: 'executed_at', type: 'datetime' }) executedAt: Date;
  @CreateDateColumn({ name: 'uploaded_at', type: 'datetime' }) uploadedAt: Date;
}
