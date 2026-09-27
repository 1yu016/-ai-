import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuthUserType } from '../../auth/entities/refresh-token-session.entity';
import {
  ClassroomEventResult,
  ClassroomEventType,
} from '../classroom-run.types';

@Entity({ name: 'classroom_event' })
@Index(['operatorType', 'operatorId', 'requestId'], { unique: true })
export class ClassroomEvent {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;
  @Column({ name: 'event_type', type: 'simple-enum', enum: ClassroomEventType })
  eventType: ClassroomEventType;
  @Column({ name: 'request_id', type: 'varchar', length: 100 })
  requestId: string;
  @Column({ name: 'operator_type', type: 'simple-enum', enum: AuthUserType })
  operatorType: AuthUserType;
  @Column({ name: 'operator_id', type: 'integer' }) operatorId: number;
  @Column({ name: 'device_id', type: 'integer', nullable: true })
  deviceId: number | null;
  @Column({ type: 'text', nullable: true }) payload: string | null;
  @Column({ type: 'simple-enum', enum: ClassroomEventResult })
  result: ClassroomEventResult;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
