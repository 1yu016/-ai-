import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum AuthUserType {
  Teacher = 'teacher',
  Administrator = 'administrator',
}

@Entity({ name: 'refresh_token_session' })
@Index(['userType', 'userId'])
export class RefreshTokenSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_type', type: 'simple-enum', enum: AuthUserType })
  userType: AuthUserType;

  @Column({ name: 'user_id', type: 'integer' })
  userId: number;

  @Column({ name: 'token_version', type: 'integer', default: 0 })
  tokenVersion: number;

  @Index({ unique: true })
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'datetime', nullable: true })
  revokedAt: Date | null;

  @Column({
    name: 'replaced_by_session_id',
    type: 'varchar',
    length: 36,
    nullable: true,
  })
  replacedBySessionId: string | null;

  @Column({ name: 'device_info', type: 'varchar', length: 255, nullable: true })
  deviceInfo: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
