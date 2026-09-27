import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuthUserType } from '../../auth/entities/refresh-token-session.entity';
import { AuditResult } from '../platform.types';

@Entity({ name: 'audit_log' })
export class AuditLog {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'actor_type', type: 'simple-enum', enum: AuthUserType })
  actorType: AuthUserType;
  @Index() @Column({ name: 'actor_id', type: 'integer' }) actorId: number;
  @Index() @Column({ type: 'varchar', length: 100 }) action: string;
  @Column({ name: 'target_type', type: 'varchar', length: 100, nullable: true })
  targetType: string | null;
  @Column({ name: 'target_id', type: 'varchar', length: 100, nullable: true })
  targetId: string | null;
  @Column({
    type: 'simple-enum',
    enum: AuditResult,
    default: AuditResult.Success,
  })
  result: AuditResult;
  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;
  @Column({ type: 'text', nullable: true }) metadata: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
