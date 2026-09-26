import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OwnedEntity } from './owned.entity';

@Entity({ name: 'emotion_event' })
export class EmotionEvent extends OwnedEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'session_id', type: 'integer', nullable: true })
  sessionId: number | null;

  @Column({ type: 'varchar', length: 50 })
  emotion: string;

  @Column({ type: 'integer', nullable: true })
  intensity: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
