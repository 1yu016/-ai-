import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AvatarVoiceStatus } from '../avatar.types';

@Entity({ name: 'avatar_voice_profile' })
@Index(['characterId'], { unique: true })
export class AvatarVoiceProfile {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'character_id', type: 'integer' }) characterId: number;
  @Column({ type: 'varchar', length: 80 }) provider: string;
  @Column({ name: 'voice_id', type: 'varchar', length: 160 }) voiceId: string;
  @Column({ type: 'varchar', length: 32 }) language: string;
  @Column({ type: 'real', default: 1 }) speed: number;
  @Column({ type: 'real', default: 1 }) volume: number;
  @Column({ type: 'real', default: 0 }) pitch: number;
  @Column({
    type: 'simple-enum',
    enum: AvatarVoiceStatus,
    default: AvatarVoiceStatus.Active,
  })
  status: AvatarVoiceStatus;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
