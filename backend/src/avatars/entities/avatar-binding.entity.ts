import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AvatarBindingScope, AvatarBindingStatus } from '../avatar.types';

@Entity({ name: 'avatar_binding' })
@Index(['scopeType', 'scopeId', 'status'])
export class AvatarBinding {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'scope_type', type: 'simple-enum', enum: AvatarBindingScope })
  scopeType: AvatarBindingScope;
  @Column({ name: 'scope_id', type: 'integer', default: 0 }) scopeId: number;
  @Column({ name: 'character_id', type: 'integer' }) characterId: number;
  @Column({ name: 'version_id', type: 'integer' }) versionId: number;
  @Column({ name: 'created_by', type: 'integer' }) createdBy: number;
  @Column({
    type: 'simple-enum',
    enum: AvatarBindingStatus,
    default: AvatarBindingStatus.Active,
  })
  status: AvatarBindingStatus;
  @Column({ name: 'cancelled_at', type: 'datetime', nullable: true })
  cancelledAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
