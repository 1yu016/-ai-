import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuthUserType } from '../../auth/entities/refresh-token-session.entity';

@Entity({ name: 'ai_call_log' })
export class AiCallLog {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({
    name: 'actor_type',
    type: 'simple-enum',
    enum: AuthUserType,
    nullable: true,
  })
  actorType: AuthUserType | null;
  @Index()
  @Column({ name: 'actor_id', type: 'integer', nullable: true })
  actorId: number | null;
  @Column({ type: 'varchar', length: 100 }) feature: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) provider:
    string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) model:
    string | null;
  @Column({ name: 'request_id', type: 'varchar', length: 100, nullable: true })
  requestId: string | null;
  @Column({ type: 'varchar', length: 30 }) status: string;
  @Column({ name: 'latency_ms', type: 'integer', nullable: true }) latencyMs:
    number | null;
  @Column({ name: 'error_code', type: 'varchar', length: 100, nullable: true })
  errorCode: string | null;
  @Column({ type: 'text', nullable: true }) metadata: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
