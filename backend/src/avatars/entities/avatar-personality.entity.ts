import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'avatar_personality' })
@Index(['characterId'], { unique: true })
export class AvatarPersonality {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'character_id', type: 'integer' }) characterId: number;
  @Column({ type: 'varchar', length: 80 }) style: string;
  @Column({ type: 'text', default: '[]' }) catchphrases: string;
  @Column({ type: 'varchar', length: 500 }) greeting: string;
  @Column({ name: 'encouragement_style', type: 'varchar', length: 500 })
  encouragementStyle: string;
  @Column({ name: 'goodbye_text', type: 'varchar', length: 500 })
  goodbyeText: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
