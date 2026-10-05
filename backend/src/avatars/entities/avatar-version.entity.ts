import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AvatarModelFormat, AvatarVersionStatus } from '../avatar.types';

@Entity({ name: 'avatar_version' })
@Index(['characterId', 'version'], { unique: true })
export class AvatarVersion {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'character_id', type: 'integer' })
  characterId: number;
  @Column({ type: 'integer' }) version: number;
  @Column({ name: 'engine_version', type: 'varchar', length: 100 })
  engineVersion: string;
  @Column({
    name: 'model_format',
    type: 'simple-enum',
    enum: AvatarModelFormat,
  })
  modelFormat: AvatarModelFormat;
  @Column({ type: 'varchar', length: 64, nullable: true })
  checksum: string | null;
  @Column({
    type: 'simple-enum',
    enum: AvatarVersionStatus,
    default: AvatarVersionStatus.Draft,
  })
  status: AvatarVersionStatus;
  @Column({ type: 'text', default: '{}' }) compatibility: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
