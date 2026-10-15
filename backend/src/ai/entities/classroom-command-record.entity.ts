import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  ClassroomCommandRecognitionSource,
  ClassroomCommandRecordStatus,
  ClassroomCommandV2Intent,
} from '../dto/classroom-command-v2.dto';

@Entity({ name: 'classroom_command_record' })
@Index(['teacherId', 'requestId'], { unique: true })
export class ClassroomCommandRecord {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;
  @Index()
  @Column({ name: 'teacher_id', type: 'integer' })
  teacherId: number;
  @Column({ name: 'request_id', type: 'varchar', length: 100 })
  requestId: string;
  @Column({ name: 'text_hash', type: 'varchar', length: 64 }) textHash: string;
  @Column({ type: 'varchar', length: 10 }) locale: string;
  @Column({
    type: 'simple-enum',
    enum: ClassroomCommandRecognitionSource,
  })
  source: ClassroomCommandRecognitionSource;
  @Column({ type: 'simple-enum', enum: ClassroomCommandV2Intent })
  intent: ClassroomCommandV2Intent;
  @Column({ type: 'text', default: '{}' }) parameters: string;
  @Column({ type: 'real' }) confidence: number;
  @Column({ type: 'text', default: '[]' }) candidates: string;
  @Column({ name: 'requires_confirmation', type: 'boolean', default: true })
  requiresConfirmation: boolean;
  @Index({ unique: true })
  @Column({
    name: 'execution_token_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  executionTokenHash: string | null;
  @Column({
    name: 'execution_token_expires_at',
    type: 'datetime',
    nullable: true,
  })
  executionTokenExpiresAt: Date | null;
  @Column({ name: 'execution_token_used_at', type: 'datetime', nullable: true })
  executionTokenUsedAt: Date | null;
  @Column({ name: 'confirmed_at', type: 'datetime', nullable: true })
  confirmedAt: Date | null;
  @Column({ type: 'simple-enum', enum: ClassroomCommandRecordStatus })
  status: ClassroomCommandRecordStatus;
  @Column({ type: 'varchar', length: 300 }) message: string;
  @Column({ name: 'execution_result', type: 'text', nullable: true })
  executionResult: string | null;
  @Column({ name: 'error_code', type: 'varchar', length: 100, nullable: true })
  errorCode: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
