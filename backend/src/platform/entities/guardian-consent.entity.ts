import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ConsentStatus, ConsentType } from '../platform.types';

@Entity({ name: 'guardian_consent' })
@Index(['studentId', 'consentType'], { unique: true })
export class GuardianConsent {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'student_id', type: 'integer' }) studentId: number;
  @Column({ name: 'consent_type', type: 'simple-enum', enum: ConsentType })
  consentType: ConsentType;
  @Column({
    type: 'simple-enum',
    enum: ConsentStatus,
    default: ConsentStatus.Pending,
  })
  status: ConsentStatus;
  @Column({ name: 'consented_at', type: 'datetime', nullable: true })
  consentedAt: Date | null;
  @Column({ name: 'revoked_at', type: 'datetime', nullable: true })
  revokedAt: Date | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) note: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
