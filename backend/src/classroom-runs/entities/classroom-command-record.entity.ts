import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AuthUserType } from '../../auth/entities/refresh-token-session.entity';
import {
  ClassroomCommandOperation,
  ClassroomCommandSource,
  ClassroomCommandStatus,
} from '../classroom-command.types';

@Entity({ name: 'classroom_operation_record' })
export class ClassroomCommandRecord {
  @PrimaryGeneratedColumn() id: number;

  @Index({ unique: true })
  @Column({ name: 'request_id', type: 'varchar', length: 100 })
  requestId: string;

  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash: string;

  @Column({ type: 'simple-enum', enum: ClassroomCommandSource })
  source: ClassroomCommandSource;

  @Column({ type: 'simple-enum', enum: ClassroomCommandOperation })
  operation: ClassroomCommandOperation;

  @Column({ name: 'operator_type', type: 'simple-enum', enum: AuthUserType })
  operatorType: AuthUserType;

  @Column({ name: 'operator_id', type: 'integer' })
  operatorId: number;

  @Column({ name: 'device_id', type: 'integer' })
  deviceId: number;

  @Column({ name: 'target_device_id', type: 'integer', nullable: true })
  targetDeviceId: number | null;

  @Column({ name: 'expected_version', type: 'integer' })
  expectedVersion: number;

  @Column({ name: 'parameters_summary', type: 'text', nullable: true })
  parametersSummary: string | null;

  @Column({ type: 'simple-enum', enum: ClassroomCommandStatus })
  status: ClassroomCommandStatus;

  @Column({ name: 'http_status', type: 'integer', nullable: true })
  httpStatus: number | null;

  @Column({ name: 'failure_reason', type: 'varchar', length: 500, nullable: true })
  failureReason: string | null;

  @Column({ name: 'response_payload', type: 'text', nullable: true })
  responsePayload: string | null;

  @Column({ name: 'executed_at', type: 'datetime', nullable: true })
  executedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
