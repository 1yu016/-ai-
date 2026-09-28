import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AuthUserType } from '../../auth/entities/refresh-token-session.entity';
import { AvatarCategory, AvatarCharacterStatus } from '../avatar.types';

@Entity({ name: 'avatar_character' })
@Index(['ownerType', 'ownerId'])
export class AvatarCharacter {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 120 }) name: string;
  @Column({ type: 'simple-enum', enum: AvatarCategory })
  category: AvatarCategory;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ name: 'owner_type', type: 'simple-enum', enum: AuthUserType })
  ownerType: AuthUserType;
  @Column({ name: 'owner_id', type: 'integer' }) ownerId: number;
  @Index()
  @Column({ name: 'school_id', type: 'varchar', length: 64, nullable: true })
  schoolId: string | null;
  @Column({
    type: 'simple-enum',
    enum: AvatarCharacterStatus,
    default: AvatarCharacterStatus.Draft,
  })
  status: AvatarCharacterStatus;
  @Column({ name: 'current_version_id', type: 'integer', nullable: true })
  currentVersionId: number | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
